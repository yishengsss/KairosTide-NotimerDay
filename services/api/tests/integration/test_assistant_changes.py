"""M2.5: changing, cancelling and excusing saved events through drafts. NOW is Monday 09:00 Asia/Shanghai."""

from datetime import date, datetime, time, timedelta
from typing import Any

from kairos.adapters.sqlite.unit_of_work import SqliteUnitOfWorkFactory
from kairos.domain.events import Occurrence, RecurrenceRule
from kairos.domain.identity import occurrence_id
from kairos.domain.recurrence import materialize
from tests.conftest import Harness
from tests.fake_model import call
from tests.integration.test_assistant_api import API, send, start

QUERY = "query_rigid_events"
CHANGE = "propose_event_change"
CANCEL = "propose_event_cancel"
EXCUSE = "propose_event_excuse"
LOOKUP = {"basis_phrase": "组会"}


def seed_single(h: Harness) -> str:
    """组会 tomorrow (Tuesday 2026-10-13) 14:00–15:00 local."""
    start_at = datetime.fromisoformat("2026-10-13T14:00:00+08:00")
    return h.events.create("local", "组会", "理科楼", "Asia/Shanghai", start_at, start_at + timedelta(hours=1)).event_id


def seed_weekly(h: Harness) -> str:
    """高数课 every Tuesday 08:00–09:40 local, 2026-10-13 .. 2026-11-24."""
    rule = RecurrenceRule("weekly", date(2026, 10, 13), date(2026, 11, 24), (2,), time(8), time(9, 40))
    start_at = datetime.fromisoformat("2026-10-13T08:00:00+08:00")
    return h.events.create("local", "高数课", "教三 204", "Asia/Shanghai", start_at,
                           start_at + timedelta(minutes=100), rule).event_id


def occurrences(h: Harness, days: int = 30) -> list[Occurrence]:
    now = h.clock.now()
    with SqliteUnitOfWorkFactory(h.path)(write=False) as uow:
        return materialize(uow.events.list_series("local"), uow.occurrences.states("local"),
                           now - timedelta(days=1), now + timedelta(days=days))


def commit(h: Harness, draft: dict[str, Any], key: str = "c1", token: str | None = None) -> Any:
    body: dict[str, Any] = {"digest": draft["digest"]}
    if token is not None:
        body["conflict_acceptance"] = token
    return h.client.post(f"{API}/drafts/{draft['draft_id']}/commit", json=body, headers={"Idempotency-Key": key})


def test_a_target_not_looked_up_this_turn_is_refused(harness: Harness) -> None:
    event_id = seed_single(harness)
    target = occurrence_id(event_id, "single")
    harness.model.then("", call(CANCEL, occurrence_id=target, basis_phrases=["取消明天的组会"]))
    body = send(harness, start(harness), "取消明天的组会").json()
    assert body["draft"] is None and body["tool_results"][0]["status"] == "rejected"
    assert "本轮" in body["tool_results"][0]["data"]


def test_moving_a_single_event_shows_before_and_after_and_writes_only_on_confirm(harness: Harness) -> None:
    event_id = seed_single(harness)
    target = occurrence_id(event_id, "single")
    harness.model.then("", call(QUERY, **LOOKUP), call(
        CHANGE, occurrence_id=target, start_at="2026-10-13T16:00:00+08:00",
        basis_phrases=["把明天的组会改到四点"]))
    body = send(harness, start(harness), "把明天的组会改到四点").json()
    draft = body["draft"]
    assert body["tool_results"][0]["data"][0]["recurring"] is False
    assert draft["kind"] == "change" and draft["status"] == "ready"
    assert draft["target"]["start_at"].startswith("2026-10-13T06:00")
    assert draft["fields"]["start_at"].startswith("2026-10-13T08:00")
    assert draft["fields"]["end_at"].startswith("2026-10-13T09:00")  # the length is kept
    assert [item.start_at.hour for item in occurrences(harness)] == [6]  # nothing moved yet

    calls = harness.model.calls
    response = commit(harness, draft)
    assert response.status_code == 200, response.text
    assert harness.model.calls == calls
    [moved] = occurrences(harness)
    assert (moved.start_at.hour, moved.end_at.hour, moved.version) == (8, 9, 2)
    assert commit(harness, draft).json() == response.json()  # replay


def test_a_new_clock_time_must_be_quoted(harness: Harness) -> None:
    event_id = seed_single(harness)
    harness.model.then("", call(QUERY, **LOOKUP), call(
        CHANGE, occurrence_id=occurrence_id(event_id, "single"), start_at="2026-10-13T16:00:00+08:00",
        basis_phrases=["组会"]))
    body = send(harness, start(harness), "组会往后挪一挪吧").json()
    assert body["draft"] is None and body["tool_results"][1]["status"] == "rejected"


def test_a_shift_phrase_backs_a_new_time(harness: Harness) -> None:
    event_id = seed_single(harness)
    harness.model.then("", call(QUERY, **LOOKUP), call(
        CHANGE, occurrence_id=occurrence_id(event_id, "single"), start_at="2026-10-13T15:00:00+08:00",
        basis_phrases=["组会推迟一小时"]))
    body = send(harness, start(harness), "组会推迟一小时").json()
    assert body["draft"] is not None and body["draft"]["kind"] == "change"


def test_changing_one_instance_leaves_the_others(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    first = occurrence_id(event_id, "2026-10-13")
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CHANGE, occurrence_id=first, location="教五 101", basis_phrases=["明天的高数课换到教五 101"]))
    draft = send(harness, start(harness), "明天的高数课换到教五 101").json()["draft"]
    assert draft["target"]["scope"] == "occurrence" and draft["target"]["recurring"] is True
    assert commit(harness, draft).status_code == 200
    places = [item.location for item in occurrences(harness)]
    assert places[0] == "教五 101" and set(places[1:]) == {"教三 204"}


def test_moving_one_instance_keeps_its_identity(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    first = occurrence_id(event_id, "2026-10-13")
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CHANGE, occurrence_id=first, start_at="2026-10-13T10:00:00+08:00",
        basis_phrases=["明天的高数课改到十点"]))
    draft = send(harness, start(harness), "明天的高数课改到十点").json()["draft"]
    assert commit(harness, draft).status_code == 200
    items = occurrences(harness)
    assert items[0].occurrence_id == first and items[0].start_at.hour == 2  # 10:00 local
    assert all(item.start_at.hour == 0 for item in items[1:])


def test_whole_series_needs_the_users_own_words(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    first = occurrence_id(event_id, "2026-10-13")
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CANCEL, occurrence_id=first, scope="series", basis_phrases=["高数课取消"]))
    body = send(harness, start(harness), "高数课取消", "m1").json()
    assert body["draft"] is None and "整个系列" in body["tool_results"][1]["data"]


def test_series_rename_changes_every_instance(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    first = occurrence_id(event_id, "2026-10-13")
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CHANGE, occurrence_id=first, scope="series", title="高等数学",
        basis_phrases=["以后高数课都叫高等数学"]))
    draft = send(harness, start(harness), "以后高数课都叫高等数学").json()["draft"]
    assert draft["target"]["scope"] == "series"
    assert commit(harness, draft).status_code == 200
    assert {item.title for item in occurrences(harness)} == {"高等数学"}


def test_series_cannot_be_retimed(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CHANGE, occurrence_id=occurrence_id(event_id, "2026-10-13"), scope="series",
        start_at="2026-10-13T10:00:00+08:00", basis_phrases=["以后高数课都改到十点"]))
    body = send(harness, start(harness), "以后高数课都改到十点").json()
    assert body["draft"] is None and "不能改时间" in body["tool_results"][1]["data"]


def test_cancelling_one_instance_and_the_whole_series(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    first = occurrence_id(event_id, "2026-10-13")
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CANCEL, occurrence_id=first, basis_phrases=["明天的高数课取消"]))
    conversation_id = start(harness)
    draft = send(harness, conversation_id, "明天的高数课取消", "m1").json()["draft"]
    assert draft["kind"] == "cancel" and draft["fields"]["title"] == "高数课"
    assert commit(harness, draft).status_code == 200
    items = occurrences(harness)
    assert items[0].disposition == "cancelled" and {item.disposition for item in items[1:]} == {"scheduled"}

    second = occurrence_id(event_id, "2026-10-20")
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CANCEL, occurrence_id=second, scope="series", basis_phrases=["高数课以后都不上了"]))
    draft = send(harness, conversation_id, "高数课以后都不上了", "m2").json()["draft"]
    assert draft["target"]["scope"] == "series"
    assert commit(harness, draft, "c2").status_code == 200
    assert occurrences(harness) == []


def test_cancelling_a_single_event_removes_it(harness: Harness) -> None:
    event_id = seed_single(harness)
    harness.model.then("", call(QUERY, **LOOKUP), call(
        CANCEL, occurrence_id=occurrence_id(event_id, "single"), basis_phrases=["明天的组会取消"]))
    draft = send(harness, start(harness), "明天的组会取消").json()["draft"]
    assert commit(harness, draft).status_code == 200
    assert occurrences(harness) == []


def test_excuse_touches_only_this_instance(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        EXCUSE, occurrence_id=occurrence_id(event_id, "2026-10-13"), basis_phrases=["明天高数课请假"]))
    draft = send(harness, start(harness), "明天高数课请假").json()["draft"]
    assert draft["kind"] == "excuse"
    assert commit(harness, draft).status_code == 200
    items = occurrences(harness)
    assert items[0].disposition == "excused" and {item.disposition for item in items[1:]} == {"scheduled"}


def test_a_target_changed_meanwhile_is_a_version_conflict(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    first = occurrence_id(event_id, "2026-10-13")
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CANCEL, occurrence_id=first, basis_phrases=["明天的高数课取消"]))
    draft = send(harness, start(harness), "明天的高数课取消").json()["draft"]
    response = harness.client.post(f"{API}/occurrences/{first}/exception",
                                   json={"expected_version": 1}, headers={"Idempotency-Key": "x1"})
    assert response.status_code == 200, response.text
    stale = commit(harness, draft)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"


def test_moving_onto_another_event_needs_review(harness: Harness) -> None:
    event_id = seed_single(harness)
    start_at = datetime.fromisoformat("2026-10-13T16:00:00+08:00")
    harness.events.create("local", "答疑", None, "Asia/Shanghai", start_at, start_at + timedelta(minutes=30))
    harness.model.then("", call(QUERY, **LOOKUP), call(
        CHANGE, occurrence_id=occurrence_id(event_id, "single"), start_at="2026-10-13T16:00:00+08:00",
        basis_phrases=["组会改到四点"]))
    draft = send(harness, start(harness), "组会改到四点").json()["draft"]
    review = commit(harness, draft)
    assert review.status_code == 409 and review.json()["error"]["code"] == "CONFLICT_REVIEW_REQUIRED"
    ok = commit(harness, draft, "c2", review.json()["error"]["acceptance_token"])
    assert ok.status_code == 200, ok.text
    assert sorted(item.title for item in occurrences(harness)) == sorted(["组会", "答疑"])


def test_a_negated_action_is_vetoed_but_a_plain_cancel_is_not(harness: Harness) -> None:
    event_id = seed_single(harness)
    target = occurrence_id(event_id, "single")
    harness.model.then("", call(QUERY, **LOOKUP), call(CANCEL, occurrence_id=target, basis_phrases=["组会"]))
    body = send(harness, start(harness), "先别取消组会").json()
    assert body["draft"] is None and body["tool_results"][1]["status"] == "rejected"


def test_a_tampered_scope_is_refused(harness: Harness) -> None:
    event_id = seed_weekly(harness)
    harness.model.then("", call(QUERY, basis_phrase="高数课"), call(
        CANCEL, occurrence_id=occurrence_id(event_id, "2026-10-13"), basis_phrases=["明天的高数课取消"]))
    draft = send(harness, start(harness), "明天的高数课取消").json()["draft"]
    response = commit(harness, {**draft, "digest": "f" * 64})
    assert response.status_code == 409 and all(item.disposition == "scheduled" for item in occurrences(harness))
