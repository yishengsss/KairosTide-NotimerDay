"""M3 Wave 1C: flexible tasks through full assistant turns. NOW is Monday 09:00 Asia/Shanghai."""

from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any

from kairos.adapters.sqlite.unit_of_work import SqliteUnitOfWorkFactory
from kairos.application.assistant.tools import SCHEMA_BY_NAME
from kairos.domain.tasks import FlexibleTask
from tests.conftest import Harness
from tests.fake_model import call
from tests.integration.test_assistant_api import send, start
from tests.integration.test_assistant_changes import commit

CREATE = "create_flexible_task_draft"
QUERY = "query_flexible_tasks"
CHANGE = "propose_task_change"
CANCEL = "propose_task_cancel"
ZONE = "Asia/Shanghai"


def tasks(h: Harness) -> list[FlexibleTask]:
    with SqliteUnitOfWorkFactory(h.path)(write=False) as uow:
        return list(uow.tasks.list_tasks("local"))


def seed_task(h: Harness, title: str = "操作系统实验") -> str:
    task = FlexibleTask("tsk_seed", "local", 1, title, ZONE, "planned",
                        datetime.fromisoformat("2026-10-18T23:59:59+08:00"), "date")
    with SqliteUnitOfWorkFactory(h.path)(write=True) as uow:
        uow.tasks.add_task(task, h.clock.now())
        uow.commit()
    return task.task_id


def turn(h: Harness, text: str, *calls: Any) -> dict[str, Any]:
    h.model.then("", *calls)
    body: dict[str, Any] = send(h, start(h), text).json()
    return body


def test_task_tools_are_on_the_whitelist_and_lifecycle_is_not() -> None:
    assert {CREATE, QUERY, CHANGE, CANCEL} <= set(SCHEMA_BY_NAME)
    assert not any("lifecycle" in name or "complete" in name for name in SCHEMA_BY_NAME)
    assert "start_at" not in SCHEMA_BY_NAME[CREATE].parameters["properties"]


def test_a_task_draft_writes_only_on_confirm(harness: Harness) -> None:
    body = turn(harness, "这周要背单词", call(CREATE, title="背单词", timezone=ZONE, basis_phrases=["要背单词"]))
    draft = body["draft"]
    assert draft["kind"] == "task_create" and draft["status"] == "ready"
    assert tasks(harness) == []
    response = commit(harness, draft)
    assert response.status_code == 200, response.text
    [saved] = tasks(harness)
    assert (saved.title, saved.lifecycle, saved.deadline) == ("背单词", "planned", None)
    assert commit(harness, draft).json() == response.json()
    assert len(tasks(harness)) == 1


def test_a_date_deadline_from_a_day_only(harness: Harness) -> None:
    body = turn(harness, "周日前写完操作系统实验", call(
        CREATE, title="写操作系统实验", timezone=ZONE, deadline="2026-10-18T23:59:59+08:00",
        precision="date", basis_phrases=["周日前写完操作系统实验"]))
    assert body["draft"]["fields"]["precision"] == "date"


def test_an_instant_deadline_needs_a_quoted_clock_time(harness: Harness) -> None:
    body = turn(harness, "周五前交报告", call(
        CREATE, title="交报告", timezone=ZONE, deadline="2026-10-16T18:00:00+08:00",
        precision="instant", basis_phrases=["周五前交报告"]))
    assert body["draft"] is None and body["tool_results"][0]["status"] == "rejected"
    ok = turn(harness, "周五下午六点前交报告", call(
        CREATE, title="交报告", timezone=ZONE, deadline="2026-10-16T18:00:00+08:00",
        precision="instant", basis_phrases=["周五下午六点前交报告"]))
    assert ok["draft"]["fields"]["precision"] == "instant"


def test_an_invented_title_basis_is_refused(harness: Harness) -> None:
    body = turn(harness, "我最近好累", call(CREATE, title="休息", timezone=ZONE, basis_phrases=["要休息"]))
    assert body["draft"] is None and body["tool_results"][0]["status"] == "rejected"


def test_denial_and_hypothesis_make_no_task(harness: Harness) -> None:
    for text in ("别加背单词了", "如果我要背单词呢"):
        body = turn(harness, text, call(CREATE, title="背单词", timezone=ZONE, basis_phrases=["背单词"]))
        assert body["draft"] is None, text
    assert tasks(harness) == []


def test_a_missing_title_asks(harness: Harness) -> None:
    body = turn(harness, "帮我记个待办", call(CREATE, timezone=ZONE, basis_phrases=["帮我记个待办"]))
    assert body["draft"]["status"] == "needs_clarification"


def test_query_lists_tasks(harness: Harness) -> None:
    seed_task(harness)
    body = turn(harness, "我有哪些待办", call(QUERY, basis_phrase="我有哪些待办"))
    [item] = body["tool_results"][0]["data"]
    assert item["title"] == "操作系统实验" and item["lifecycle"] == "planned"


def test_change_requires_a_lookup_this_turn(harness: Harness) -> None:
    task_id = seed_task(harness)
    body = turn(harness, "把操作系统实验改名为大实验",
                call(CHANGE, task_id=task_id, title="大实验", basis_phrases=["改名为大实验"]))
    assert body["draft"] is None and "本轮" in body["tool_results"][0]["data"]


def test_rename_after_lookup_commits(harness: Harness) -> None:
    task_id = seed_task(harness)
    body = turn(harness, "把操作系统实验改名为大实验", call(QUERY, basis_phrase="操作系统实验"),
                call(CHANGE, task_id=task_id, title="大实验", basis_phrases=["改名为大实验"]))
    draft = body["draft"]
    assert draft["kind"] == "task_change" and tasks(harness)[0].title == "操作系统实验"
    assert commit(harness, draft).status_code == 200
    assert tasks(harness)[0].title == "大实验"


def test_cancel_after_lookup_commits(harness: Harness) -> None:
    task_id = seed_task(harness)
    body = turn(harness, "操作系统实验不做了", call(QUERY, basis_phrase="操作系统实验"),
                call(CANCEL, task_id=task_id, basis_phrases=["操作系统实验不做了"]))
    draft = body["draft"]
    assert draft["kind"] == "task_cancel"
    assert commit(harness, draft).status_code == 200
    assert tasks(harness) == []


def test_a_task_changed_after_the_draft_is_stale(harness: Harness) -> None:
    task_id = seed_task(harness)
    body = turn(harness, "把操作系统实验改名为大实验", call(QUERY, basis_phrase="操作系统实验"),
                call(CHANGE, task_id=task_id, title="大实验", basis_phrases=["改名为大实验"]))
    with SqliteUnitOfWorkFactory(harness.path)(write=True) as uow:
        current = uow.tasks.get_task("local", task_id)
        assert current is not None
        uow.tasks.update_task(replace(current, version=current.version + 1, lifecycle="active"),
                              current.version, harness.clock.now() + timedelta(seconds=1))
        uow.commit()
    assert commit(harness, body["draft"]).status_code == 409
