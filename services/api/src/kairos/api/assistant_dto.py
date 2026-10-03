"""HTTP models for the assistant: conversations, turns and drafts."""

from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from .dto import Strict

DraftStatus = Literal["needs_clarification", "ready", "committed", "superseded", "discarded"]


class ConversationCreated(Strict):
    conversation_id: str
    revision: int


class SendMessageRequest(Strict):
    client_message_id: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=4000)
    timezone: str = Field(min_length=1, max_length=64)
    expected_revision: int = Field(ge=0)


class ToolResult(Strict):
    name: str
    status: Literal["ok", "rejected", "clarify", "unavailable"]
    data: Any
    draft_id: str | None


class Recurrence(Strict):
    frequency: Literal["daily", "weekly"]
    starts_on: str
    ends_on: str
    weekdays: list[int]
    local_start: str
    local_end: str
    end_day_offset: int
    gap_policy: Literal["skip"] | None
    fold_policy: Literal["earlier", "later"] | None


class DraftFields(Strict):
    title: str | None
    timezone: str | None
    start_at: datetime | None
    end_at: datetime | None
    location: str | None
    recurrence: Recurrence | None
    deadline: datetime | None = Field(
        default=None, description="Flexible tasks only: when the user wants it done by.")
    precision: Literal["date", "instant"] | None = Field(
        default=None, description="date when the user named a day, instant when a clock time was named.")


class DraftTarget(Strict):
    """The saved instance a change draft acts on, as it was when the draft was made."""

    occurrence_id: str
    event_id: str
    original_slot: str
    scope: Literal["occurrence", "series"]
    recurring: bool
    occurrence_version: int
    series_version: int
    title: str
    location: str | None
    start_at: datetime
    end_at: datetime


class TaskTarget(Strict):
    """The saved flexible task a task_change / task_cancel draft acts on, as it was when made."""

    task_id: str
    task_version: int
    title: str
    deadline: datetime | None
    precision: Literal["date", "instant"] | None


class Draft(Strict):
    draft_id: str
    conversation_id: str
    status: DraftStatus
    digest: str
    fields: DraftFields
    missing: list[str]
    basis_phrase: str
    anchor_at: datetime
    expires_at: datetime
    superseded_by: str | None
    committed_event_id: str | None
    expired: bool
    confirmable: bool
    kind: Literal["create", "change", "cancel", "excuse",
                  "task_create", "task_change", "task_cancel"] = Field(
        description="create makes a new event; the others act on `target`. `fields` is the result after the change."
                    " The task_* kinds act on a flexible task, which has a deadline instead of a slot.")
    target: DraftTarget | TaskTarget | None


class TurnResult(Strict):
    conversation_id: str
    revision: int
    user_message_id: str
    assistant_message_id: str
    answer: str
    tool_results: list[ToolResult]
    draft: Draft | None


class Message(Strict):
    message_id: str
    sequence: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    action_results: list[ToolResult]
    draft_id: str | None


class MessagePage(Strict):
    conversation_id: str
    revision: int
    items: list[Message]
    next_cursor: int | None
    pending_client_message_id: str | None = Field(
        description="An unfinished turn. Resend with this ID to resume it instead of starting another.")
    draft: Draft | None


class CommitRequest(Strict):
    digest: str = Field(min_length=1, max_length=128)
    conflict_acceptance: str | None = Field(default=None, max_length=128)


class CommitResult(Strict):
    draft_id: str
    event_id: str
    status: Literal["committed"]


class DiscardResult(Strict):
    draft_id: str
    status: Literal["discarded"]


class AssistantStatus(Strict):
    available: bool
