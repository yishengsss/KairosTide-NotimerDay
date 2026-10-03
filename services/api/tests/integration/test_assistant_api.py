"""Assistant conversations through HTTP, with a scripted model. NOW is 09:00 Asia/Shanghai."""

from datetime import datetime, timedelta
from typing import Any

import pytest

from kairos.adapters.sqlite.unit_of_work import SqliteUnitOfWorkFactory
from kairos.application.assistant.conversation import AssistantService
from kairos.application.assistant.drafts import DraftService
from kairos.application.errors import NotFound
from tests.conftest import Harness
from tests.fake_model import call

API = "/api/v1"
DRAFT = "create_rigid_event_draft"
MEETING = {"title": "组会", "timezone": "Asia/Shanghai", "start_at": "2026-10-13T14:00:00+08:00",
           "end_at": "2026-10-13T15:00:00+08:00", "basis_phrase": "明天下午两点到三点开组会"}


def start(h: Harness) -> str:
    response = h.client.post(f"{API}/conversations")
    assert response.status_code == 201, response.text
    conversation_id: str = response.json()["conversation_id"]
    return conversation_id


def send(h: Harness, conversation_id: str, content: str, client_id: str = "m1",
         revision: int | None = None) -> Any:
    if revision is None:
        revision = h.client.get(f"{API}/conversations/{conversation_id}/messages").json()["revision"]
    return h.client.post(f"{API}/conversations/{conversation_id}/messages", json={
        "client_message_id": client_id, "content": content, "timezone": "Asia/Shanghai",
        "expected_revision": revision})


def test_without_a_key_chat_is_503_and_the_rest_still_works(no_model: Harness) -> None:
    assert no_model.client.get(f"{API}/assistant/status").json() == {"available": False}
    conversation_id = start(no_model)
    response = send(no_model, conversation_id, "你好")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ASSISTANT_UNAVAILABLE"
    assert no_model.client.get(f"{API}/state").status_code == 200


def test_plain_answer_is_stored_and_history_restores_it(harness: Harness) -> None:
    harness.model.then("你好，我在。")
    conversation_id = start(harness)
    body = send(harness, conversation_id, "你好").json()
    assert body["answer"] == "你好，我在。" and body["draft"] is None
    page = harness.client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert [item["role"] for item in page["items"]] == ["user", "assistant"]
    assert page["revision"] == body["revision"] and page["pending_client_message_id"] is None


def test_draft_is_not_schedule_until_committed(harness: Harness) -> None:
    harness.model.then("", call(DRAFT, **MEETING)).then("整理好了，确认后保存。")
    conversation_id = start(harness)
    body = send(harness, conversation_id, "明天下午两点到三点开组会").json()
    draft = body["draft"]
    assert draft["status"] == "ready" and draft["confirmable"] and draft["missing"] == []
    harness.advance(harness.clock.now().replace(hour=6) - harness.clock.now())  # 14:00 local today, not tomorrow
    assert harness.state()["active"] == []

    calls_before = harness.model.calls
    response = harness.client.post(f"{API}/drafts/{draft['draft_id']}/commit", json={"digest": draft["digest"]},
                                   headers={"Idempotency-Key": "c1"})
    assert response.status_code == 200, response.text
    assert harness.model.calls == calls_before  # confirming never talks to the model
    replay = harness.client.post(f"{API}/drafts/{draft['draft_id']}/commit", json={"digest": draft["digest"]},
                                 headers={"Idempotency-Key": "c1"})
    assert replay.json() == response.json()
    harness.advance(harness.clock.now().replace(day=13, hour=6, minute=10) - harness.clock.now())
    assert [item["title"] for item in harness.state()["active"]] == ["组会"]


def test_missing_time_is_asked_for_never_defaulted(harness: Harness) -> None:
    harness.model.then("", call(DRAFT, title="组会", timezone="Asia/Shanghai", basis_phrase="明天开组会"))
    conversation_id = start(harness)
    draft = send(harness, conversation_id, "明天开组会").json()["draft"]
    assert draft["status"] == "needs_clarification"
    assert draft["fields"]["start_at"] is None and "start_at" in draft["missing"]
    response = harness.client.post(f"{API}/drafts/{draft['draft_id']}/commit", json={"digest": draft["digest"]},
                                   headers={"Idempotency-Key": "c1"})
    assert response.status_code == 409 and response.json()["error"]["code"] == "DRAFT_NOT_READY"


def test_invented_basis_is_rejected(harness: Harness) -> None:
    harness.model.then("", call(DRAFT, **{**MEETING, "basis_phrase": "周五去爬山"}))
    conversation_id = start(harness)
    body = send(harness, conversation_id, "明天下午两点到三点开组会").json()
    assert body["draft"] is None
    assert body["tool_results"][0]["status"] == "rejected"


def test_denial_vetoes_a_write_even_if_the_model_tries(harness: Harness) -> None:
    sentence = "先不要记明天下午两点到三点开组会"
    harness.model.then("", call(DRAFT, **{**MEETING, "basis_phrase": "明天下午两点到三点开组会"}))
    conversation_id = start(harness)
    body = send(harness, conversation_id, sentence).json()
    assert body["draft"] is None and body["tool_results"][0]["status"] == "rejected"


def test_unknown_tool_is_refused_without_side_effects(harness: Harness) -> None:
    harness.model.then("", call("delete_everything", basis_phrase="你好"))
    conversation_id = start(harness)
    body = send(harness, conversation_id, "你好").json()
    assert body["tool_results"][0]["status"] == "rejected"


def test_editing_supersedes_and_the_old_draft_cannot_be_committed(harness: Harness) -> None:
    later = {**MEETING, "start_at": "2026-10-13T16:00:00+08:00", "end_at": "2026-10-13T17:00:00+08:00",
             "basis_phrase": "改到四点"}
    harness.model.then("", call(DRAFT, **MEETING)).then("好").then("", call(DRAFT, **later)).then("改好了")
    conversation_id = start(harness)
    first = send(harness, conversation_id, "明天下午两点到三点开组会", "m1").json()["draft"]
    second = send(harness, conversation_id, "改到四点", "m2").json()["draft"]
    stale = harness.client.post(f"{API}/drafts/{first['draft_id']}/commit", json={"digest": first["digest"]},
                                headers={"Idempotency-Key": "c1"})
    assert stale.status_code == 409
    assert stale.json()["error"] == {"code": "DRAFT_SUPERSEDED", "message": stale.json()["error"]["message"],
                                     "superseded_by": second["draft_id"]}


def test_tampered_digest_is_refused(harness: Harness) -> None:
    harness.model.then("", call(DRAFT, **MEETING))
    conversation_id = start(harness)
    draft = send(harness, conversation_id, "明天下午两点到三点开组会").json()["draft"]
    response = harness.client.post(f"{API}/drafts/{draft['draft_id']}/commit", json={"digest": "0" * 64},
                                   headers={"Idempotency-Key": "c1"})
    assert response.status_code == 409 and response.json()["error"]["code"] == "DRAFT_NOT_READY"


def test_overlap_needs_review_and_a_stale_token_fails(harness: Harness) -> None:
    from datetime import timedelta

    harness.seed(timedelta(hours=29), minutes=60, title="高数课")  # 2026-10-13 14:00 local
    harness.model.then("", call(DRAFT, **MEETING))
    conversation_id = start(harness)
    draft = send(harness, conversation_id, "明天下午两点到三点开组会").json()["draft"]
    url = f"{API}/drafts/{draft['draft_id']}/commit"
    review = harness.client.post(url, json={"digest": draft["digest"]}, headers={"Idempotency-Key": "c1"})
    assert review.status_code == 409
    error = review.json()["error"]
    assert error["code"] == "CONFLICT_REVIEW_REQUIRED" and len(error["conflicts"]) == 1

    harness.seed(timedelta(hours=29, minutes=30), minutes=20, title="答疑")  # joins the window meanwhile
    stale = harness.client.post(url, json={"digest": draft["digest"], "conflict_acceptance": error["acceptance_token"]},
                                headers={"Idempotency-Key": "c2"})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "CONFLICT_REVIEW_REQUIRED"
    fresh = stale.json()["error"]["acceptance_token"]
    ok = harness.client.post(url, json={"digest": draft["digest"], "conflict_acceptance": fresh},
                             headers={"Idempotency-Key": "c3"})
    assert ok.status_code == 200, ok.text


def test_same_client_message_is_replayed_not_rerun(harness: Harness) -> None:
    harness.model.then("一次")
    conversation_id = start(harness)
    first = send(harness, conversation_id, "你好", "m1", revision=0).json()
    again = send(harness, conversation_id, "你好", "m1", revision=0).json()
    assert again == first and harness.model.calls == 1
    reused = send(harness, conversation_id, "别的话", "m1", revision=0)
    assert reused.status_code == 409


def test_failed_model_call_leaves_a_resumable_turn(harness: Harness) -> None:
    conversation_id = start(harness)
    harness.model.fail = True
    assert send(harness, conversation_id, "你好", "m1", revision=0).status_code == 503
    page = harness.client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert page["pending_client_message_id"] == "m1"
    blocked = send(harness, conversation_id, "另一句", "m2", revision=page["revision"])
    assert blocked.status_code == 409
    harness.model.fail = False
    harness.model.then("恢复了")
    resumed = send(harness, conversation_id, "你好", "m1", revision=0).json()
    assert resumed["answer"] == "恢复了"
    roles = [m["role"] for m in harness.client.get(f"{API}/conversations/{conversation_id}/messages").json()["items"]]
    assert roles == ["user", "assistant"]


def test_stale_revision_is_refused(harness: Harness) -> None:
    conversation_id = start(harness)
    send(harness, conversation_id, "你好", "m1", revision=0)
    assert send(harness, conversation_id, "再说一句", "m2", revision=0).status_code == 409


def test_queries_are_read_only_and_weather_carries_its_source(harness: Harness) -> None:
    from datetime import timedelta

    harness.seed(timedelta(hours=3))
    harness.model.then("", call("query_rigid_events", basis_phrase="今天有什么课"),
                       call("query_weather", city="西安", basis_phrase="西安天气")).then("今天有高数课，西安在下雨。")
    conversation_id = start(harness)
    body = send(harness, conversation_id, "今天有什么课？西安天气呢").json()
    events, weather = body["tool_results"]
    assert events["status"] == "ok" and events["data"][0]["title"] == "高数课"
    assert weather["status"] == "ok" and weather["data"]["source"] == "fake" and weather["data"]["observed_at"]
    assert body["draft"] is None


def test_weather_outage_is_reported_not_invented(harness: Harness) -> None:
    harness.weather.fail = True
    harness.model.then("", call("query_weather", city="西安", basis_phrase="西安天气"))
    conversation_id = start(harness)
    body = send(harness, conversation_id, "西安天气").json()
    assert body["tool_results"][0]["status"] == "unavailable"


def test_discard_closes_the_draft(harness: Harness) -> None:
    harness.model.then("", call(DRAFT, **MEETING))
    conversation_id = start(harness)
    draft = send(harness, conversation_id, "明天下午两点到三点开组会").json()["draft"]
    url = f"{API}/drafts/{draft['draft_id']}"
    assert harness.client.post(f"{url}/discard", headers={"Idempotency-Key": "d1"}).status_code == 200
    assert harness.client.get(url).json()["status"] == "discarded"
    response = harness.client.post(f"{url}/commit", json={"digest": draft["digest"]},
                                   headers={"Idempotency-Key": "c1"})
    assert response.status_code == 409


def test_other_owners_cannot_see_a_conversation(harness: Harness) -> None:
    response = harness.client.get(f"{API}/conversations/cnv_missing/messages")
    assert response.status_code == 404

    # A second owner, through the same services the routes use: nothing of the first owner's is visible.
    harness.model.then("", call(DRAFT, **MEETING)).then("整理好了。")
    conversation_id = start(harness)
    draft = send(harness, conversation_id, "明天下午两点到三点开组会").json()["draft"]
    uow = SqliteUnitOfWorkFactory(harness.path)
    assistant = AssistantService(uow, harness.clock, model=harness.model)
    drafts = DraftService(uow, harness.clock)
    for attempt in (lambda: assistant.history("intruder", conversation_id),
                    lambda: assistant.draft_view("intruder", draft["draft_id"]),
                    lambda: assistant.send("intruder", conversation_id, "x1", "你好", "Asia/Shanghai", 2),
                    lambda: drafts.commit("intruder", draft["draft_id"], draft["digest"], "k1"),
                    lambda: drafts.discard("intruder", draft["draft_id"], "k2")):
        with pytest.raises(NotFound):
            attempt()
    still = harness.client.get(f"{API}/drafts/{draft['draft_id']}").json()
    assert still["status"] == "ready"


def test_confirming_hours_later_keeps_the_start_resolved_at_the_anchor(harness: Harness) -> None:
    harness.model.then("", call(DRAFT, **MEETING)).then("整理好了。")
    conversation_id = start(harness)
    draft = send(harness, conversation_id, "明天下午两点到三点开组会").json()["draft"]
    anchor = draft["anchor_at"]
    harness.advance(timedelta(hours=5))
    later = harness.client.get(f"{API}/drafts/{draft['draft_id']}").json()
    assert later["anchor_at"] == anchor and later["fields"]["start_at"] == draft["fields"]["start_at"]
    response = harness.client.post(f"{API}/drafts/{draft['draft_id']}/commit", json={"digest": draft["digest"]},
                                   headers={"Idempotency-Key": "late"})
    assert response.status_code == 200, response.text
    harness.advance(harness.clock.now().replace(day=13, hour=6, minute=5) - harness.clock.now())
    active = harness.state()["active"]
    assert [item["title"] for item in active] == ["组会"]
    assert datetime.fromisoformat(active[0]["start_at"]) == datetime.fromisoformat(MEETING["start_at"])


def test_the_model_is_told_the_current_local_date_and_zone(harness: Harness) -> None:
    # Without this a real model cannot resolve「明天」(found with live MiMo: it asked for the date instead).
    harness.model.then("好的")
    send(harness, start(harness), "明天有什么安排")
    system = " ".join(m.content for m in harness.model.seen[0] if m.role == "system")
    assert "2026-10-12" in system and "星期一" in system and "Asia/Shanghai" in system and "+08:00" in system


def test_reload_shows_what_became_of_the_last_draft(harness: Harness) -> None:
    # Found end to end: after confirming, a reload lost the card, as if the draft had never existed.
    harness.model.then("", call(DRAFT, **MEETING)).then("整理好了。")
    conversation_id = start(harness)
    draft = send(harness, conversation_id, "明天下午两点到三点开组会").json()["draft"]
    harness.client.post(f"{API}/drafts/{draft['draft_id']}/commit", json={"digest": draft["digest"]},
                        headers={"Idempotency-Key": "k"})
    page = harness.client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert page["draft"]["draft_id"] == draft["draft_id"] and page["draft"]["status"] == "committed"


def test_a_clarifying_draft_is_superseded_by_the_completed_one(harness: Harness) -> None:
    partial = {key: value for key, value in MEETING.items() if key not in ("start_at", "end_at")}
    harness.model.then("", call(DRAFT, **partial)).then("几点？")
    conversation_id = start(harness)
    first = send(harness, conversation_id, "明天下午两点到三点开组会", "m1").json()["draft"]
    assert first["status"] == "needs_clarification"
    harness.model.then("", call(DRAFT, **MEETING)).then("好了。")
    second = send(harness, conversation_id, "明天下午两点到三点开组会", "m2").json()["draft"]
    old = harness.client.get(f"{API}/drafts/{first['draft_id']}").json()
    assert old["status"] == "superseded" and old["superseded_by"] == second["draft_id"]


def test_a_draft_over_two_messages_must_quote_where_the_time_was_said(harness: Harness) -> None:
    # Found with live MiMo: the basis quoted only「提醒我开会」while the card showed a time.
    harness.model.then("几点开？")
    conversation_id = start(harness)
    send(harness, conversation_id, "提醒我开会", "m1")
    only_first = {**MEETING, "basis_phrase": "提醒我开会"}
    harness.model.then("", call(DRAFT, **only_first)).then("")
    body = send(harness, conversation_id, "明天下午两点到三点，在图书馆", "m2").json()
    assert body["draft"] is None and body["tool_results"][0]["status"] == "rejected"
    assert "时刻" in body["tool_results"][0]["data"]

    both: dict[str, object] = {key: value for key, value in MEETING.items() if key != "basis_phrase"}
    both["basis_phrases"] = ["提醒我开会", "明天下午两点到三点"]
    harness.model.then("", call(DRAFT, **both)).then("整理好了。")
    draft = send(harness, conversation_id, "就是明天下午两点到三点", "m3").json()["draft"]
    assert draft["status"] == "ready" and draft["basis_phrase"] == "提醒我开会……明天下午两点到三点"
