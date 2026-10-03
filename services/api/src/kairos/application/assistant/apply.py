"""Write a confirmed change, cancel or excuse draft (M2.5 plan §2.4). Called only from a user's confirmation.

The target is read again from storage first. If either the instance or its series moved on since the
user was shown the card, the commit is refused: a confirmation never overwrites a state the user did
not see. A time change that lands on another saved event goes through the same review as a new event.
"""

from dataclasses import replace
from datetime import datetime, timedelta

from kairos.domain.draft import Draft, DraftTarget, acceptance_token
from kairos.domain.events import Disposition, EventSeries, first_state
from kairos.domain.recurrence import materialize
from kairos.domain.time_rules import overlaps

from ..errors import ConflictReviewRequired, DraftNotReady, VersionConflict
from ..ports import UnitOfWork
from .changes import Located, locate

STALE = "这条日程在你看到草稿之后已经变了，请重新说一次"


def apply_draft(uow: UnitOfWork, draft: Draft, conflict_acceptance: str | None, now: datetime) -> str:
    """Perform the confirmed change. Returns the affected event ID."""
    target = draft.target
    if target is None:
        raise DraftNotReady("草稿缺少要改动的日程")
    if not isinstance(target, DraftTarget):
        # A flexible task draft; it has no slot and no series, so none of this applies.
        raise DraftNotReady("这份草稿改的是柔性任务，不走日程的提交路径")
    found = locate(uow, draft.owner_id, target.event_id, target.original_slot)
    if found is None or found.series.version != target.series_version \
            or found.occurrence.version != target.occurrence_version:
        raise VersionConflict(STALE)
    whole = target.scope == "series" or not target.recurring
    if draft.kind == "cancel":
        if whole:
            uow.events.delete_series(draft.owner_id, target.event_id, target.series_version)
        else:
            _advance(uow, draft, found, "cancelled", now)
    elif draft.kind == "excuse":
        _advance(uow, draft, found, "excused", now)
    elif draft.kind == "change":
        _change(uow, draft, target, found, conflict_acceptance, now)
    else:
        raise DraftNotReady("这份草稿不是改动草稿")
    return target.event_id


def _advance(uow: UnitOfWork, draft: Draft, found: Located, disposition: Disposition, now: datetime,
             override: tuple[str | None, str | None, datetime | None, datetime | None] | None = None) -> None:
    """Next version of the instance. `override` replaces its one-off (title, location, start, end)."""
    item = found.occurrence
    if item.disposition != "scheduled":
        raise VersionConflict(STALE)
    current = uow.occurrences.states(draft.owner_id).get(item.occurrence_id) or first_state(item.occurrence_id)
    state = current.advanced(disposition)
    if override is not None:
        title, location, start_at, end_at = override
        state = replace(state, title=title, location=location, start_at=start_at, end_at=end_at)
    uow.occurrences.save(draft.owner_id, item.event_id, state, current.version, now)


def _change(uow: UnitOfWork, draft: Draft, target: DraftTarget, found: Located,
            conflict_acceptance: str | None, now: datetime) -> None:
    fields = draft.fields
    assert fields.title is not None and fields.start_at is not None and fields.end_at is not None
    series = found.series
    if (fields.start_at, fields.end_at) != (target.start_at, target.end_at):
        _review_overlaps(uow, draft, target, conflict_acceptance)
    if target.recurring and target.scope == "occurrence":
        moved = (fields.start_at, fields.end_at) != (found.slot.start_at, found.slot.end_at)
        _advance(uow, draft, found, "scheduled", now, (
            fields.title if fields.title != series.title else None,
            fields.location if fields.location != series.location else None,
            fields.start_at if moved else None, fields.end_at if moved else None))
        return
    updated = EventSeries(
        event_id=series.event_id, owner_id=series.owner_id, version=series.version + 1, title=fields.title,
        location=fields.location, timezone=series.timezone,
        start_at=series.start_at if target.recurring else fields.start_at,
        end_at=series.end_at if target.recurring else fields.end_at, recurrence=series.recurrence)
    uow.events.update_series(updated, series.version)
    if not target.recurring:
        # A new version of the instance, so a "知道了" given for the old time does not silence the new one.
        _advance(uow, draft, found, "scheduled", now)


def _review_overlaps(uow: UnitOfWork, draft: Draft, target: DraftTarget, acceptance: str | None) -> None:
    fields = draft.fields
    assert fields.start_at is not None and fields.end_at is not None
    window = (fields.start_at - timedelta(days=1), fields.end_at + timedelta(days=1))
    others = [item for item in materialize(uow.events.list_series(draft.owner_id),
                                           uow.occurrences.states(draft.owner_id), *window)
              if item.disposition == "scheduled" and item.occurrence_id != target.occurrence_id
              and overlaps(fields.start_at, fields.end_at, item.start_at, item.end_at)]
    if not others:
        return
    pairs = [(target.original_slot, item.occurrence_id) for item in others]
    token = acceptance_token(draft.digest, pairs, {item.occurrence_id: item.version for item in others})
    if acceptance != token:
        raise ConflictReviewRequired(
            "改到这个时间会和已保存的日程重叠，需要你先看一下",
            {"conflicts": [{"slot": slot, "occurrence_id": other} for slot, other in pairs],
             "acceptance_token": token})
