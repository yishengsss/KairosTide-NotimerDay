"""M3 Wave 1A: changing or cancelling a flexible task only acts on this turn's lookups (rule 5)."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from kairos.adapters.sqlite.database import migrate
from kairos.adapters.sqlite.unit_of_work import SqliteUnitOfWork, SqliteUnitOfWorkFactory
from kairos.application.assistant.task_proposals import (
    PROPOSE_TASK_CANCEL,
    PROPOSE_TASK_CHANGE,
    propose_change,
)
from kairos.domain.tasks import FlexibleTask

NOW = datetime(2026, 10, 12, 1, 0, tzinfo=UTC)
ZONE = "Asia/Shanghai"


def uow_for(tmp_path: Path, lifecycle: str = "planned") -> tuple[SqliteUnitOfWork, str]:
    path = tmp_path / "kairos.sqlite3"
    migrate(path)
    factory = SqliteUnitOfWorkFactory(path)
    task = FlexibleTask("tsk_1", "local", 1, "操作系统实验", ZONE, lifecycle,  # type: ignore[arg-type]
                        NOW + timedelta(days=3), "date")
    with factory(write=True) as seed:
        seed.tasks.add_task(task, NOW)
        seed.commit()
    return factory(write=False).__enter__(), task.task_id


def test_a_task_not_looked_up_this_turn_cannot_be_changed(tmp_path: Path) -> None:
    uow, task_id = uow_for(tmp_path)
    proposal, problem = propose_change(uow, "local", PROPOSE_TASK_CHANGE,
                                       {"task_id": task_id, "title": "操作系统大实验"},
                                       ("把操作系统实验改个名",), queried={})
    assert proposal is None and problem is not None and "本轮" in problem


def test_renaming_a_task_looked_up_this_turn(tmp_path: Path) -> None:
    uow, task_id = uow_for(tmp_path)
    proposal, problem = propose_change(uow, "local", PROPOSE_TASK_CHANGE,
                                       {"task_id": task_id, "title": "操作系统大实验"},
                                       ("把操作系统实验改成大实验",), queried={task_id: 1})
    assert problem is None and proposal is not None
    assert proposal.kind == "task_change" and proposal.fields.title == "操作系统大实验"
    assert proposal.target is not None and proposal.target.task_version == 1


def test_a_version_that_moved_since_the_lookup_is_refused(tmp_path: Path) -> None:
    uow, task_id = uow_for(tmp_path)
    proposal, problem = propose_change(uow, "local", PROPOSE_TASK_CHANGE,
                                       {"task_id": task_id, "title": "操作系统大实验"},
                                       ("改个名",), queried={task_id: 99})
    assert proposal is None and problem is not None and "重新查询" in problem


def test_a_change_with_nothing_new_is_refused(tmp_path: Path) -> None:
    uow, task_id = uow_for(tmp_path)
    proposal, problem = propose_change(uow, "local", PROPOSE_TASK_CHANGE,
                                       {"task_id": task_id, "title": "操作系统实验"},
                                       ("操作系统实验",), queried={task_id: 1})
    assert proposal is None and problem is not None


def test_cancelling_snapshots_the_task(tmp_path: Path) -> None:
    uow, task_id = uow_for(tmp_path)
    proposal, problem = propose_change(uow, "local", PROPOSE_TASK_CANCEL,
                                       {"task_id": task_id}, ("不做操作系统实验了",), queried={task_id: 1})
    assert problem is None and proposal is not None
    assert proposal.kind == "task_cancel" and proposal.fields.title == "操作系统实验"
