"""Stable application errors. The API layer maps each code to an HTTP status."""

from typing import Any


class AppError(Exception):
    code = "APP_ERROR"

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        # Extra machine-readable context (conflict pairs, revision, limits). Optional, so every M1
        # call site keeps working unchanged.
        self.details = details or {}


class NotFound(AppError):
    code = "NOT_FOUND"


class VersionConflict(AppError):
    code = "VERSION_CONFLICT"


class IdempotencyMismatch(AppError):
    code = "IDEMPOTENCY_KEY_REUSED"


class InvalidRequest(AppError):
    code = "INVALID_REQUEST"


class UpstreamUnavailable(AppError):
    code = "UPSTREAM_UNAVAILABLE"


class AssistantUnavailable(AppError):
    """No model configured, or the provider could not be reached. The rest of the app still works."""

    code = "ASSISTANT_UNAVAILABLE"


class ConversationConflict(AppError):
    code = "CONVERSATION_CONFLICT"


class DraftNotReady(AppError):
    code = "DRAFT_NOT_READY"


class DraftSuperseded(AppError):
    code = "DRAFT_SUPERSEDED"


class ConflictReviewRequired(AppError):
    """The user must look at a conflict before this can be written."""

    code = "CONFLICT_REVIEW_REQUIRED"


class ContextTooLarge(AppError):
    code = "CONTEXT_TOO_LARGE"
