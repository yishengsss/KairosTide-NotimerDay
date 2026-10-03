"""M3 Wave 1A: the task lifecycle use case. The user drives it with a button, never the model.

NOW is Monday 2026-10-12 09:00 Asia/Shanghai, matching the harness clock.
"""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from kairos.adapters.clock import FixedClock
from kairos.adapters.sqlite.database import migrate
from kairos.adapters.sqlite.unit_of_work import SqliteUnitOfWorkFactory
from kairos.application.errors import InvalidRequest, NotFound, VersionConflict
from kairos.application.tasks import TaskService
from kairos.domain.tasks import FlexibleTask

NOW = datetime(2026, 10, 12, 1, 0, tzinfo=UTC)
ZONE = "Asia/Shanghai"


def service(tmp_path: Path) -> tuple[TaskService, SqliteUnitOfWorkFactory]:
    path = tmp_path / "kairos.sqlite3"
    migrate(path)
    factory = SqliteUnitOfWorkFactory(path)
    return TaskService(factory, FixedClock(NOW)), factory


def seed(factory: SqliteUnitOfWorkFactory, lifecycle: str = "planned", task_id: str = "tsk_1") -> str:
    task = FlexibleTask(task_id, "local", 1, "操作系统实验", ZONE, lifecycle,  # type: ignore[arg-type]
                        NOW + timedelta(days=3), "date")
    with factory(write=True) as uow:
        uow.tasks.add_task(task, NOW)
        uow.commit()
    return task.task_id


def test_the_user_accepts_a_task_into_the_active_pool(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory)
    result = svc.transition("local", task_id, "active", 1, "k1")
    assert result == {"task_id": task_id, "lifecycle": "active", "version": 2}


def test_the_user_pauses_an_active_task_back_to_planned(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory, "active")
    assert svc.transition("local", task_id, "planned", 1, "k1")["lifecycle"] == "planned"


def test_a_task_can_be_marked_done_from_either_pool(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    assert svc.transition("local", seed(factory), "done", 1, "k1")["lifecycle"] == "done"
    active = seed(factory, "active", "tsk_2")
    assert svc.transition("local", active, "done", 1, "k2")["lifecycle"] == "done"


def test_undoing_a_completion_lands_on_active(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory, "done")
    assert svc.transition("local", task_id, "active", 1, "k1")["lifecycle"] == "active"


def test_a_done_task_never_falls_back_into_the_planned_pool(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory, "done")
    with pytest.raises(InvalidRequest):
        svc.transition("local", task_id, "planned", 1, "k1")


def test_an_unknown_lifecycle_name_is_refused(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory)
    with pytest.raises(InvalidRequest):
        svc.transition("local", task_id, "archived", 1, "k1")


def test_a_replay_with_the_same_key_returns_the_same_result(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory)
    first = svc.transition("local", task_id, "active", 1, "k1")
    again = svc.transition("local", task_id, "active", 1, "k1")
    assert first == again
    with factory(write=False) as uow:
        assert uow.tasks.get_task("local", task_id).version == 2  # type: ignore[union-attr]


def test_a_stale_version_is_a_conflict(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory)
    svc.transition("local", task_id, "active", 1, "k1")
    with pytest.raises(VersionConflict):
        svc.transition("local", task_id, "done", 1, "k2")  # version is 2 now, not 1


def test_a_no_op_transition_is_idempotent_without_bumping_the_version(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory, "active")
    assert svc.transition("local", task_id, "active", 1, "k1") == {
        "task_id": task_id, "lifecycle": "active", "version": 1}


def test_a_missing_task_is_not_found(tmp_path: Path) -> None:
    svc, _ = service(tmp_path)
    with pytest.raises(NotFound):
        svc.transition("local", "tsk_missing", "active", 1, "k1")


def test_listing_returns_the_owners_tasks(tmp_path: Path) -> None:
    svc, factory = service(tmp_path)
    task_id = seed(factory)
    [only] = svc.list_tasks("local")
    assert only.task_id == task_id and svc.list_tasks("other") == []
