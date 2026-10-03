"""Flexible task use cases: list, lifecycle transitions, and the commit of a confirmed task draft.

Two kinds of write live here, and they come in by different doors.

**Lifecycle** (planned ↔ active, → done, done → active) is a plain button the user presses, never a
model tool (M3 plan §2.3 rule 6). It carries an idempotency key and is guarded on the version the
button was rendered against, so a double-tap or a stale tab cannot move a task twice.

**Draft commit** is the confirm-before-write path shared with events: `apply_task_draft` is called
from the draft service once the user has confirmed, and it reads the task again from storage so a
confirmation never overwrites a state the user did not see.
"""

from dataclasses import replace
from datetime import datetime
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from kairos.domain.draft import Draft
from kairos.domain.tasks import FlexibleTask, Lifecycle, TaskTarget, valid_transition

from .errors import DraftNotReady, InvalidRequest, NotFound, VersionConflict
from .idempotency import once
from .ports import Clock, UnitOfWork, UnitOfWorkFactory

STALE = "这条任务在你看到草稿之后已经变了，请重新说一次"
LIFECYCLES: tuple[Lifecycle, ...] = ("planned", "active", "done")


def task_id_for(draft_id: str) -> str:
    """Deterministic, so an idempotent replay of a commit lands on the same task."""
    return f"tsk_{uuid5(NAMESPACE_URL, f'kairos/task-draft/{draft_id}').hex}"


def apply_task_draft(uow: UnitOfWork, draft: Draft, now: datetime) -> str:
    """Write a confirmed task draft. Returns the affected task ID."""
    target = draft.target
    if draft.kind == "task_create":
        return _create(uow, draft, now)
    if not isinstance(target, TaskTarget):
        raise DraftNotReady("这份草稿缺少要改动的任务")
    stored = uow.tasks.get_task(draft.owner_id, target.task_id)
    if stored is None or stored.version != target.task_version:
        raise VersionConflict(STALE)
    if draft.kind == "task_cancel":
        uow.tasks.delete_task(draft.owner_id, target.task_id, target.task_version, now)
        return target.task_id
    if draft.kind == "task_change":
        fields = draft.fields
        if not fields.title:
            raise DraftNotReady("草稿缺少标题")
        updated = replace(stored, version=stored.version + 1, title=fields.title,
                          deadline=fields.deadline, precision=fields.precision)
        uow.tasks.update_task(updated, target.task_version, now)
        return target.task_id
    raise DraftNotReady("这份草稿不是柔性任务的改动草稿")


def _create(uow: UnitOfWork, draft: Draft, now: datetime) -> str:
    fields = draft.fields
    if not fields.title or not fields.timezone:
        raise DraftNotReady("草稿还缺少必需字段")
    task = FlexibleTask(
        task_id=task_id_for(draft.draft_id), owner_id=draft.owner_id, version=1, title=fields.title,
        timezone=fields.timezone, lifecycle="planned", deadline=fields.deadline,
        precision=fields.precision, source_message_id=draft.source_message_id)
    uow.tasks.add_task(task, now)
    return task.task_id


class TaskService:
    def __init__(self, uow: UnitOfWorkFactory, clock: Clock) -> None:
        self._uow = uow
        self._clock = clock

    def now(self) -> datetime:
        return self._clock.now()

    def list_tasks(self, owner_id: str) -> list[FlexibleTask]:
        with self._uow(write=False) as uow:
            return uow.tasks.list_tasks(owner_id)

    def transition(self, owner_id: str, task_id: str, target: str, expected_version: int,
                   key: str) -> dict[str, Any]:
        """Move a task's lifecycle. Idempotent and version-guarded; the model never calls this."""
        if target not in LIFECYCLES:
            raise InvalidRequest(f"lifecycle must be one of {', '.join(LIFECYCLES)}")
        now = self._clock.now()
        payload: dict[str, Any] = {"task_id": task_id, "target": target,
                                   "expected_version": expected_version}
        with self._uow(write=True) as uow:
            def act() -> dict[str, Any]:
                task = uow.tasks.get_task(owner_id, task_id)
                if task is None:
                    raise NotFound("task not found")
                if task.version != expected_version:
                    raise VersionConflict("task changed concurrently")
                if task.lifecycle == target:
                    return {"task_id": task_id, "lifecycle": target, "version": task.version}
                if not valid_transition(task.lifecycle, target):
                    raise InvalidRequest(f"不能从 {task.lifecycle} 切换到 {target}")
                updated = replace(task, version=task.version + 1, lifecycle=target)
                uow.tasks.update_task(updated, expected_version, now)
                uow.audit.record(owner_id, f"task_{target}", task_id, now)
                return {"task_id": task_id, "lifecycle": target, "version": updated.version}

            result = once(uow, owner_id, "task_transition", key, payload, act, now)
            uow.commit()
        return result
