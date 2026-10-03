"""MiMo adapter: decoding only, sanitised errors. No network: httpx.MockTransport stands in."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from kairos.adapters.ai.mimo import MimoModel, decode_completion
from kairos.application.assistant.conversation import MAX_CONTEXT_MESSAGES, build_context
from kairos.application.assistant.model import ModelError, ModelMessage
from kairos.application.assistant.tools import SCHEMAS
from kairos.domain.conversation import ConversationMessage

KEY = "sk-test-secret-value"


def model(handler: httpx.MockTransport) -> MimoModel:
    return MimoModel(KEY, "https://mimo.test/v1", "mimo-test", client=httpx.Client(transport=handler))


def test_tool_calls_are_decoded_and_bad_arguments_are_flagged() -> None:
    turn = decode_completion({"choices": [{"message": {"content": None, "tool_calls": [
        {"id": "a", "function": {"name": "query_weather", "arguments": '{"city":"西安","basis_phrase":"天气"}'}},
        {"id": "b", "function": {"name": "create_rigid_event_draft", "arguments": "{not json"}},
        {"id": "c", "function": {"name": "x", "arguments": "[1]"}},
        "garbage",
    ]}}]})
    assert turn.text == ""
    assert [item.name for item in turn.tool_calls] == ["query_weather", "create_rigid_event_draft", "x"]
    assert turn.tool_calls[0].arguments["city"] == "西安" and turn.tool_calls[0].malformed is None
    assert turn.tool_calls[1].malformed and turn.tool_calls[2].malformed


def test_unrecognised_body_is_a_model_error() -> None:
    with pytest.raises(ModelError):
        decode_completion({"nope": True})


def test_request_carries_whitelist_and_key_only_in_the_header() -> None:
    seen: dict[str, object] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "好"}}]})

    turn = model(httpx.MockTransport(handle)).complete([ModelMessage("user", "你好")], SCHEMAS)
    body = seen["body"]
    assert isinstance(body, dict)
    assert turn.text == "好" and seen["auth"] == f"Bearer {KEY}"
    assert body["tool_choice"] == "auto" and len(body["tools"]) == len(SCHEMAS)
    assert KEY not in json.dumps(body)


@pytest.mark.parametrize("status", [401, 429, 500])
def test_http_errors_never_echo_the_key_or_body(status: int) -> None:
    handler = httpx.MockTransport(lambda _r: httpx.Response(status, text=f"bad key {KEY}"))
    with pytest.raises(ModelError) as caught:
        model(handler).complete([ModelMessage("user", "你好")], SCHEMAS)
    assert KEY not in str(caught.value) and caught.value.__cause__ is None


def test_network_failure_drops_the_original_exception() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.headers['Authorization']}")

    with pytest.raises(ModelError) as caught:
        model(httpx.MockTransport(boom)).complete([ModelMessage("user", "你好")], SCHEMAS)
    assert KEY not in str(caught.value) and caught.value.__cause__ is None
    assert KEY not in repr(model(httpx.MockTransport(boom)))


def _messages(count: int, size: int = 10) -> list[ConversationMessage]:
    start = datetime(2026, 10, 12, tzinfo=UTC)
    return [ConversationMessage(f"m{i}", "local", "c", i, "user" if i % 2 == 0 else "assistant", "字" * size,
                                start + timedelta(seconds=i)) for i in range(count)]


def test_context_is_capped_and_starts_with_a_user_message() -> None:
    kept = build_context(_messages(60))
    assert len(kept) <= MAX_CONTEXT_MESSAGES and kept[0].role == "user" and kept[-1].message_id == "m59"


def test_latest_user_message_survives_a_huge_history() -> None:
    history = _messages(4, size=20_000)
    assert [item.message_id for item in build_context(history)] == ["m2"]
