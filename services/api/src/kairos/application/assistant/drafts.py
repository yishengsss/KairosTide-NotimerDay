"""Confirm or discard a draft. This service has no model reference on purpose.

Confirmation is a plain user decision: it reads the stored draft, checks that the client is
confirming exactly the content it was shown (the digest), and writes the event. No sentence is
re-read, no tool is re-run, so a confirmation cannot be steered by anything the model says.

Change, cancel and excuse drafts (M2.5) are written by `apply.py`; this module only dispatches.

Conflicts are never resolved here. If the new event overlaps saved ones, the first commit is refused
with the overlapping pairs and an acceptance token. Committing again with that token saves the event
and leaves the overlap in place, where the existing conflict card asks the user which one to keep.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from kairos.domain.draft import TASK_KINDS, Draft, acceptance_token
from kairos.domain.events import EventSeries, Occurrence
from kairos.domain.recurrence import MAX_WINDOW, expand_slots, materialize, zone_of
from kairos.domain.time_rules import overlaps

from ..errors import ConflictReviewRequired, DraftNotReady, DraftSuperseded, InvalidRequest, NotFound
from ..idempotency import once
from ..ports import Clock, UnitOfWork, UnitOfWorkFactory
from ..tasks import apply_task_draft
from .apply import apply_draft


@dataclass(frozen=True)
class CommitResult:
    draft_id: str
    event_id: str
    status: str

    def to_json(self) -> dict[str, Any]:
        return {"draft_id": self.draft_id, "event_id": self.event_id, "status": self.status}


def event_id_for(draft_id: str) -> str:
    """Deterministic, so a conflict probe and the commit talk about the same instances."""
    return f"evt_{uuid5(NAMESPACE_URL, f'kairos/draft/{draft_id}').hex}"


def candidate_series(draft: Draft) -> EventSeries:
    fields = draft.fields
    if fields.missing() or fields.title is None or fields.timezone is None \
            or fields.start_at is None or fields.end_at is None:
        raise DraftNotReady("草稿还缺少必需字段")
    try:
        zone_of(fields.timezone)
    except ValueError as error:
        raise InvalidRequest(str(error)) from error
    return EventSeries(event_id=event_id_for(draft.draft_id), owner_id=draft.owner_id, version=1,
                       title=fields.title, location=fields.location, timezone=fields.timezone,
                       start_at=fields.start_at, end_at=fields.end_at, recurrence=fields.recurrence)


def _span(series: EventSeries) -> tuple[datetime, datetime]:
    if series.recurrence is None:
        return series.start_at, series.end_at
    zone = zone_of(series.timezone)
    rule = series.recurrence
    start = datetime.combine(rule.starts_on, rule.local_start, zone).astimezone(UTC) - timedelta(days=1)
    end = datetime.combine(rule.ends_on, rule.local_end, zone).astimezone(UTC) + timedelta(days=2)
    if end - start > MAX_WINDOW:
        raise InvalidRequest("重复范围太长，一次最多一年")
    return start, end


def conflicts(uow: UnitOfWork, series: EventSeries) -> tuple[list[tuple[str, str]], dict[str, int]]:
    """Overlaps between the candidate's slots and saved, still-scheduled instances. Writes nothing."""
    start, end = _span(series)
    slots = expand_slots(series, start, end)
    if not slots:
        raise InvalidRequest("这个重复规则在范围内一次都不会发生")
    existing: list[Occurrence] = [
        item for item in materialize(uow.events.list_series(series.owner_id),
                                     uow.occurrences.states(series.owner_id), start, end)
        if item.disposition == "scheduled"]
    pairs: list[tuple[str, str]] = []
    versions: dict[str, int] = {}
    for slot in slots:
        for item in existing:
            if overlaps(slot.start_at, slot.end_at, item.start_at, item.end_at):
                pairs.append((slot.original_slot, item.occurrence_id))
                versions[item.occurrence_id] = item.version
    return pairs, versions


class DraftService:
    def __init__(self, uow: UnitOfWorkFactory, clock: Clock) -> None:
        self._uow = uow
        self._clock = clock

    def commit(self, owner_id: str, draft_id: str, digest: str, key: str,
               conflict_acceptance: str | None = None) -> CommitResult:
        now = self._clock.now()
        payload = {"draft_id": draft_id, "digest": digest, "conflict_acceptance": conflict_acceptance}
        with self._uow(write=True) as uow:
            def act() -> dict[str, Any]:
                draft = self._confirmable(uow, owner_id, draft_id, digest, now)
                if draft.kind in TASK_KINDS:
                    task_id = apply_task_draft(uow, draft, now)
                    uow.drafts.commit_draft(owner_id, draft_id, digest, task_id, now)
                    uow.audit.record(owner_id, "draft_committed", draft_id, now)
                    uow.audit.record(owner_id, f"{draft.kind}_committed", task_id, now)
                    return CommitResult(draft_id, task_id, "committed").to_json()
                if draft.kind != "create":
                    event_id = apply_draft(uow, draft, conflict_acceptance, now)
                    uow.drafts.commit_draft(owner_id, draft_id, digest, event_id, now)
                    uow.audit.record(owner_id, "draft_committed", draft_id, now)
                    uow.audit.record(owner_id, f"event_{draft.kind}", event_id, now)
                    return CommitResult(draft_id, event_id, "committed").to_json()
                series = candidate_series(draft)
                pairs, versions = conflicts(uow, series)
                if pairs:
                    token = acceptance_token(draft.digest, pairs, versions)
                    if conflict_acceptance != token:
                        raise ConflictReviewRequired(
                            "这条安排和已保存的日程时间重叠，需要你先看一下",
                            {"conflicts": [{"slot": slot, "occurrence_id": other} for slot, other in pairs],
                             "acceptance_token": token})
                uow.events.add_series(series, now)
                uow.drafts.commit_draft(owner_id, draft_id, digest, series.event_id, now)
                uow.audit.record(owner_id, "draft_committed", draft_id, now)
                uow.audit.record(owner_id, "event_created", series.event_id, now)
                return CommitResult(draft_id, series.event_id, "committed").to_json()

            result = once(uow, owner_id, "draft_commit", key, payload, act, now)
            uow.commit()
        return CommitResult(result["draft_id"], result["event_id"], result["status"])

    def discard(self, owner_id: str, draft_id: str, key: str) -> dict[str, Any]:
        now = self._clock.now()
        with self._uow(write=True) as uow:
            def act() -> dict[str, Any]:
                draft = uow.drafts.get(owner_id, draft_id)
                if draft is None:
                    raise NotFound("draft not found")
                if draft.status not in ("ready", "needs_clarification"):
                    raise DraftNotReady(f"草稿已经是 {draft.status} 状态")
                uow.drafts.discard(owner_id, draft_id, now)
                uow.audit.record(owner_id, "draft_discarded", draft_id, now)
                return {"draft_id": draft_id, "status": "discarded"}

            result = once(uow, owner_id, "draft_discard", key, {"draft_id": draft_id}, act, now)
            uow.commit()
        return result

    @staticmethod
    def _confirmable(uow: UnitOfWork, owner_id: str, draft_id: str, digest: str, now: datetime) -> Draft:
        draft = uow.drafts.get(owner_id, draft_id)
        if draft is None:
            raise NotFound("draft not found")
        if draft.status == "superseded":
            raise DraftSuperseded("这份草稿已经被新的草稿取代", {"superseded_by": draft.superseded_by})
        if draft.status != "ready":
            raise DraftNotReady(f"草稿是 {draft.status} 状态，不能保存")
        if draft.expired(now):
            raise DraftNotReady("草稿已经过期，请重新说一次")
        if draft.digest != digest:
            raise DraftNotReady("草稿内容和你看到的不一致，请刷新后再确认")
        return draft
