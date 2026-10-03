"""Xiaomi MiMo over its OpenAI-compatible chat completions endpoint.

Decodes, never acts: this adapter returns the model's text and proposed tool calls and has no access
to storage. Errors are sanitised: the key, request body and raw response never reach a message.
"""

import json
from collections.abc import Sequence
from typing import Any

import httpx

from kairos.application.assistant.model import (
    MAX_ANSWER_CHARS,
    MAX_TOOL_CALLS,
    ModelError,
    ModelMessage,
    ModelTurn,
    ToolCall,
    ToolSchema,
)


def _decode_call(raw: Any, index: int) -> ToolCall | None:
    if not isinstance(raw, dict):
        return None
    function = raw.get("function")
    if not isinstance(function, dict) or not isinstance(function.get("name"), str):
        return None
    raw_id = raw.get("id")
    call_id = raw_id if isinstance(raw_id, str) and raw_id else f"call_{index}"
    arguments = function.get("arguments")
    if isinstance(arguments, dict):
        return ToolCall(call_id, function["name"], arguments)
    if not isinstance(arguments, str):
        return ToolCall(call_id, function["name"], {}, malformed="缺少参数")
    try:
        parsed = json.loads(arguments) if arguments.strip() else {}
    except ValueError:
        return ToolCall(call_id, function["name"], {}, malformed="无法解析")
    if not isinstance(parsed, dict):
        return ToolCall(call_id, function["name"], {}, malformed="不是对象")
    return ToolCall(call_id, function["name"], parsed)


def decode_completion(data: Any) -> ModelTurn:
    """Pure: an OpenAI-style completion body to a ModelTurn. Unknown shapes are a ModelError."""
    if not isinstance(data, dict):
        raise ModelError("模型返回了无法识别的结果")
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ModelError("模型返回了无法识别的结果")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ModelError("模型返回了无法识别的结果")
    content = message.get("content")
    text = content[:MAX_ANSWER_CHARS] if isinstance(content, str) else ""
    raw_calls = message.get("tool_calls")
    calls: list[ToolCall] = []
    if isinstance(raw_calls, list):
        for index, raw in enumerate(raw_calls[:MAX_TOOL_CALLS]):
            decoded = _decode_call(raw, index)
            if decoded is not None:
                calls.append(decoded)
    return ModelTurn(text, tuple(calls))


class MimoModel:
    def __init__(self, api_key: str, base_url: str, model: str, client: httpx.Client | None = None,
                 timeout: float = 45.0) -> None:
        if not api_key:
            raise ValueError("MiMo needs an API key")
        self._key = api_key
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        self._client = client or httpx.Client(timeout=timeout)

    def __repr__(self) -> str:  # never print the key, even in a traceback's locals
        return f"MimoModel(model={self._model!r})"

    def complete(self, messages: Sequence[ModelMessage], tools: Sequence[ToolSchema]) -> ModelTurn:
        body: dict[str, Any] = {"model": self._model, "messages": [item.to_json() for item in messages],
                                "temperature": 0.2}
        if tools:
            body["tools"] = [schema.to_json() for schema in tools]
            body["tool_choice"] = "auto"
        try:
            response = self._client.post(self._url, json=body,
                                         headers={"Authorization": f"Bearer {self._key}"})
        # `from None` everywhere: the original exception can carry the request, including the header.
        except httpx.TimeoutException:
            raise ModelError("模型响应超时") from None
        except httpx.HTTPError:
            raise ModelError("连不上模型服务") from None
        if response.status_code in (401, 403):
            raise ModelError("模型服务拒绝了密钥，请检查 services/api/.env")
        if response.status_code == 429:
            raise ModelError("模型服务暂时繁忙，请稍后再试")
        if response.status_code >= 400:
            raise ModelError(f"模型服务返回错误（HTTP {response.status_code}）")
        try:
            data = response.json()
        except ValueError:
            raise ModelError("模型返回了无法识别的结果") from None
        return decode_completion(data)
