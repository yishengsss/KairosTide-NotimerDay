import hashlib
from datetime import timedelta
from typing import Any

from tests.conftest import Harness


def digest(path: Any) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def post(h: Harness, url: str, body: dict[str, Any], key: str = "k1") -> Any:
    return h.client.post(url, json=body, headers={"Idempotency-Key": key})


def test_state_is_read_only(harness: Harness) -> None:
    harness.seed(timedelta(minutes=3))
    harness.state()
    before = digest(harness.path)
    for _ in range(3):
        harness.state()
    assert digest(harness.path) == before


def test_reminder_appears_and_ack_hides_it(harness: Harness) -> None:
    harness.seed(timedelta(minutes=6))
    assert harness.state()["reminders"] == []
    harness.advance(timedelta(minutes=1, seconds=1))
    (reminder,) = harness.state()["reminders"]
    response = post(harness, f"/api/v1/reminders/{reminder['occurrence_id']}/ack", {"occurrence_version": 1})
    assert response.status_code == 200, response.text
    assert harness.state()["reminders"] == []


def test_ack_replay_and_key_reuse(harness: Harness) -> None:
    harness.seed(timedelta(minutes=4))
    harness.seed(timedelta(minutes=3), title="英语")
    first, second = harness.state()["reminders"]
    url = f"/api/v1/reminders/{first['occurrence_id']}/ack"
    one = post(harness, url, {"occurrence_version": 1})
    assert post(harness, url, {"occurrence_version": 1}).json() == one.json()
    reused = post(harness, f"/api/v1/reminders/{second['occurrence_id']}/ack", {"occurrence_version": 1})
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_missing_idempotency_key_is_rejected(harness: Harness) -> None:
    harness.seed(timedelta(minutes=3))
    (reminder,) = harness.state()["reminders"]
    response = harness.client.post(f"/api/v1/reminders/{reminder['occurrence_id']}/ack",
                                   json={"occurrence_version": 1})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_exception_excuses_only_that_instance(harness: Harness) -> None:
    harness.seed(timedelta(minutes=-1))
    harness.seed(timedelta(minutes=-2), title="实验")
    active = harness.state()["active"]
    assert len(active) == 2
    target = active[0]
    response = post(harness, f"/api/v1/occurrences/{target['occurrence_id']}/exception", {"expected_version": 1})
    assert response.status_code == 200, response.text
    assert response.json()["disposition"] == "excused" and response.json()["version"] == 2
    remaining = harness.state()["active"]
    assert [item["occurrence_id"] for item in remaining] == [active[1]["occurrence_id"]]


def test_exception_with_stale_version_conflicts(harness: Harness) -> None:
    harness.seed(timedelta(minutes=-1))
    (item,) = harness.state()["active"]
    url = f"/api/v1/occurrences/{item['occurrence_id']}/exception"
    assert post(harness, url, {"expected_version": 1}).status_code == 200
    stale = post(harness, url, {"expected_version": 1}, key="k2")
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"


def test_unknown_occurrence_is_404(harness: Harness) -> None:
    response = post(harness, "/api/v1/occurrences/occ_nope/exception", {"expected_version": 1})
    assert response.status_code == 404 and response.json()["error"]["code"] == "NOT_FOUND"


def test_conflict_decision_marks_others_missed(harness: Harness) -> None:
    harness.seed(timedelta(minutes=-5), 30, "高数")
    harness.seed(timedelta(minutes=-1), 30, "社团")
    state = harness.state()
    (group,) = state["conflicts"]
    chosen = group[0]
    response = post(harness, "/api/v1/conflict-decisions",
                    {"group": group, "chosen_occurrence_id": chosen, "state_revision": state["state_revision"]})
    assert response.status_code == 200, response.text
    assert response.json()["missed_occurrence_ids"] == [group[1]]
    after = harness.state()
    assert after["conflicts"] == [] and [item["occurrence_id"] for item in after["active"]] == [chosen]


def test_conflict_decision_rejects_stale_revision(harness: Harness) -> None:
    harness.seed(timedelta(minutes=-5), 30)
    harness.seed(timedelta(minutes=-1), 30)
    state = harness.state()
    (group,) = state["conflicts"]
    harness.seed(timedelta(minutes=-2), 30, "新加入")
    response = post(harness, "/api/v1/conflict-decisions",
                    {"group": group, "chosen_occurrence_id": group[0], "state_revision": state["state_revision"]})
    assert response.status_code == 409


def test_next_transition_and_lead_are_exposed(harness: Harness) -> None:
    harness.seed(timedelta(minutes=12))
    state = harness.state()
    assert state["reminder_lead_seconds"] == 300
    assert state["next_transition_at"] == "2026-10-12T01:07:00Z"
