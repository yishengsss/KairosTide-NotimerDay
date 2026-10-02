"""Conversation facts: ordered messages and the at-most-one unfinished turn.

The server is the authority on transcript order, the unfinished turn and draft references; a browser
only ever holds a conversation ID. Nothing here knows about models or tools.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

MessageRole = Literal["user", "assistant"]
TurnStatus = Literal["pending", "completed"]

# A turn that was reserved but never completed keeps the conversation busy. Retrying the same client
# message ID resumes it; a different ID is refused until it finishes or is given up on.
MAX_CLIENT_MESSAGE_ID = 200


@dataclass(frozen=True)
class Conversation:
    conversation_id: str
    owner_id: str
    revision: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ConversationMessage:
    message_id: str
    owner_id: str
    conversation_id: str
    sequence: int
    role: MessageRole
    content: str
    created_at: datetime
    action_results: tuple[dict[str, Any], ...] = ()
    draft_id: str | None = None


@dataclass(frozen=True)
class ConversationTurn:
    """One send attempt. `response` is what the client got, stored so a retry returns it unchanged."""

    owner_id: str
    conversation_id: str
    client_message_id: str
    user_message_id: str
    request_hash: str
    content: str
    timezone: str
    expected_revision: int
    status: TurnStatus
    created_at: datetime
    assistant_message_id: str | None = None
    response: dict[str, Any] | None = None
