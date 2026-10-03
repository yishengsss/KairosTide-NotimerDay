"""M3 Wave 2: the task HTTP routes. Lifecycle is button-driven, idempotent and version-guarded."""

from httpx import Response

from tests.conftest import Harness
from tests.integration.test_assistant_api import API
from tests.integration.test_assistant_tasks import seed_task


def move(h: Harness, task_id: str, target: str, version: int, key: str) -> Response:
    response: Response = h.client.post(f"{API}/tasks/{task_id}/lifecycle",
                                       json={"target": target, "expected_version": version},
                                       headers={"Idempotency-Key": key})
    return response


def test_list_shows_saved_tasks(harness: Harness) -> None:
    seed_task(harness)
    body = harness.client.get(f"{API}/tasks").json()
    [item] = body["items"]
    assert item["title"] == "操作系统实验" and item["lifecycle"] == "planned" and item["overdue"] is False


def test_start_then_finish_then_undo(harness: Harness) -> None:
    task_id = seed_task(harness)
    first = move(harness, task_id, "active", 1, "k1")
    assert first.status_code == 200 and first.json()["version"] == 2
    assert move(harness, task_id, "active", 1, "k1").json() == first.json()
    assert move(harness, task_id, "done", 2, "k2").json()["lifecycle"] == "done"
    assert move(harness, task_id, "active", 3, "k3").json()["lifecycle"] == "active"


def test_done_cannot_go_back_to_planned(harness: Harness) -> None:
    task_id = seed_task(harness)
    move(harness, task_id, "done", 1, "k1")
    assert move(harness, task_id, "planned", 2, "k2").status_code == 422


def test_a_stale_version_conflicts(harness: Harness) -> None:
    task_id = seed_task(harness)
    move(harness, task_id, "active", 1, "k1")
    assert move(harness, task_id, "done", 1, "k2").status_code == 409


def test_unknown_task_is_404(harness: Harness) -> None:
    assert move(harness, "tsk_none", "active", 1, "k1").status_code == 404
