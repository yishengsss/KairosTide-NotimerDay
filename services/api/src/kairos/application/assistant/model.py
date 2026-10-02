"""What the assistant needs from a language model: decode intent, never act.

The adapter's only job is to turn a request into a `ModelTurn`. It has no repository, no unit of
work and no clock, so it structurally cannot write anything; the application layer decides what, if
anything, a proposed tool call is allowed to do.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

MessageRole = Literal["system", "user", "assistant", "tool"]

MAX_TOOL_CALLS = 8
MAX_ANSWER_CHARS = 4000


@dataclass(frozen=True)
class ToolSchema:
    name: str
    description: str
    parameters: dict[str, Any]

    def to_json(self) -> dict[str, Any]:
        return {"type": "function",
                "function": {"name": self.name, "description": self.description, "parameters": self.parameters}}


@dataclass(frozen=True)
class ModelMessage:
    role: MessageRole
    content: str
    tool_calls: tuple["ToolCall", ...] = ()
    tool_call_id: str | None = None

    def to_json(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.tool_calls:
            payload["tool_calls"] = [call.to_json() for call in self.tool_calls]
        if self.tool_call_id is not None:
            payload["tool_call_id"] = self.tool_call_id
        return payload


@dataclass(frozen=True)
class ToolCall:
    """One thing the model wants to do. `arguments` is only parsed here; nothing is validated yet."""

    call_id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    malformed: str | None = None
    """Set when the provider sent arguments that are not a JSON object, so the caller can refuse."""

    def to_json(self) -> dict[str, Any]:
        return {"id": self.call_id, "type": "function",
                "function": {"name": self.name, "arguments": json.dumps(self.arguments, ensure_ascii=False)}}


@dataclass(frozen=True)
class ModelTurn:
    text: str
    tool_calls: tuple[ToolCall, ...] = ()


class AssistantModel(Protocol):
    def complete(self, messages: Sequence[ModelMessage], tools: Sequence[ToolSchema]) -> ModelTurn: ...


class ModelError(Exception):
    """The provider could not answer. Message text must stay free of keys and raw response bodies."""
