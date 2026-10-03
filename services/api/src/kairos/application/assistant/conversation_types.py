"""Results of a conversation turn, shared by the turn runner and the read-only tools."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolOutcome:
    name: str
    status: str
    data: Any
    draft_id: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {"name": self.name, "status": self.status, "data": self.data, "draft_id": self.draft_id}


@dataclass(frozen=True)
class TurnResult:
    conversation_id: str
    revision: int
    user_message_id: str
    assistant_message_id: str
    answer: str
    tool_results: tuple[ToolOutcome, ...]
    draft: dict[str, Any] | None

    def to_json(self) -> dict[str, Any]:
        return {"conversation_id": self.conversation_id, "revision": self.revision,
                "user_message_id": self.user_message_id, "assistant_message_id": self.assistant_message_id,
                "answer": self.answer, "tool_results": [item.to_json() for item in self.tool_results],
                "draft": self.draft}

    @staticmethod
    def from_json(raw: dict[str, Any]) -> "TurnResult":
        return TurnResult(
            conversation_id=raw["conversation_id"], revision=raw["revision"],
            user_message_id=raw["user_message_id"], assistant_message_id=raw["assistant_message_id"],
            answer=raw["answer"],
            tool_results=tuple(ToolOutcome(item["name"], item["status"], item["data"], item.get("draft_id"))
                               for item in raw["tool_results"]),
            draft=raw["draft"])


@dataclass(frozen=True)
class MessagePage:
    conversation_id: str
    revision: int
    items: tuple[dict[str, Any], ...]
    next_cursor: int | None
    pending_client_message_id: str | None
    draft: dict[str, Any] | None
