"""Write the ticked items of a batch draft (M4 §2.2). Called only from the user's confirmation.

The selection is part of the request, and the conflict acceptance token pins the selection too, so a
review accepted for three items cannot be reused to save five. Every item ID is derived from the draft
and the item's position, so an idempotent replay lands on the same rows.
"""

from collections.abc import Sequence
from datetime import datetime
from uuid import NAMESPACE_URL, uuid5

from kairos.domain.batch import BatchItem, item_key, items_from_json
from kairos.domain.draft import Draft, acceptance_token
from kairos.domain.events import EventSeries
from kairos.domain.tasks import FlexibleTask

from ..errors import ConflictReviewRequired, DraftNotReady, InvalidRequest
from ..ports import UnitOfWork


def _uuid(prefix: str, seed: str) -> str:
    return f"{prefix}_{uuid5(NAMESPACE_URL, f'kairos/batch/{seed}').hex}"


def _series(draft: Draft, index: int, item: BatchItem) -> EventSeries:
    fields = item.fields
    assert fields.title and fields.timezone and fields.start_at and fields.end_at
    return EventSeries(event_id=_uuid("evt", item_key(draft.draft_id, index)), owner_id=draft.owner_id,
                       version=1, title=fields.title, location=fields.location, timezone=fields.timezone,
                       start_at=fields.start_at, end_at=fields.end_at, recurrence=None)


def _task(draft: Draft, index: int, item: BatchItem) -> FlexibleTask:
    fields = item.fields
    assert fields.title and fields.timezone
    return FlexibleTask(task_id=_uuid("tsk", item_key(draft.draft_id, index)), owner_id=draft.owner_id,
                        version=1, title=fields.title, timezone=fields.timezone, lifecycle="planned",
                        deadline=fields.deadline, precision=fields.precision,
                        source_message_id=draft.source_message_id)


def apply_batch(uow: UnitOfWork, draft: Draft, selected: Sequence[int] | None,
                conflict_acceptance: str | None, now: datetime) -> list[str]:
    """Save the selected items. Returns their IDs in item order."""
    from .drafts import conflicts

    items = items_from_json(draft.items_raw)
    if not selected:
        raise InvalidRequest("至少勾选一条再保存")
    chosen = sorted(set(selected))
    if any(index < 0 or index >= len(items) for index in chosen):
        raise InvalidRequest("勾选的条目不在这份草稿里")
    if any(not items[index].selectable for index in chosen):
        raise DraftNotReady("勾选的条目里有还没补全的，先取消勾选它")
    series = [(index, _series(draft, index, items[index])) for index in chosen if items[index].kind == "create"]
    pairs: list[tuple[str, str]] = []
    versions: dict[str, int] = {}
    for index, candidate in series:
        found, seen = conflicts(uow, candidate)
        pairs.extend((f"{index}:{slot}", other) for slot, other in found)
        versions.update(seen)
    if pairs:
        token = acceptance_token(f"{draft.digest}|{','.join(map(str, chosen))}", pairs, versions)
        if conflict_acceptance != token:
            raise ConflictReviewRequired(
                "勾选的安排里有和已保存日程时间重叠的，需要你先看一下",
                {"conflicts": [{"slot": slot, "occurrence_id": other} for slot, other in pairs],
                 "acceptance_token": token})
    saved: list[str] = []
    for index in chosen:
        item = items[index]
        if item.kind == "create":
            event = _series(draft, index, item)
            uow.events.add_series(event, now)
            uow.audit.record(draft.owner_id, "event_created", event.event_id, now)
            saved.append(event.event_id)
        else:
            task = _task(draft, index, item)
            uow.tasks.add_task(task, now)
            uow.audit.record(draft.owner_id, "task_create_committed", task.task_id, now)
            saved.append(task.task_id)
    return saved
