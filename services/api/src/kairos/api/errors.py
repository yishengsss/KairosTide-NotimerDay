"""Map application errors and validation failures to one JSON error shape."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from kairos.application.errors import (
    AppError,
    AssistantUnavailable,
    ConflictReviewRequired,
    ContextTooLarge,
    ConversationConflict,
    DraftNotReady,
    DraftSuperseded,
    IdempotencyMismatch,
    InvalidRequest,
    NotFound,
    UpstreamUnavailable,
    VersionConflict,
)

STATUS: dict[type[AppError], int] = {
    NotFound: 404, VersionConflict: 409, IdempotencyMismatch: 409, InvalidRequest: 422, UpstreamUnavailable: 503,
    AssistantUnavailable: 503, ConversationConflict: 409, DraftNotReady: 409, DraftSuperseded: 409,
    ConflictReviewRequired: 409, ContextTooLarge: 413,
}


def _body(code: str, message: str, status: int, details: dict[str, Any] | None = None) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details:
        body["error"].update(details)
    return JSONResponse(body, status_code=status)


def install(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_request: Request, exc: AppError) -> JSONResponse:
        return _body(exc.code, exc.message, STATUS.get(type(exc), 400), exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", ()))
        return _body("INVALID_REQUEST", f"{location}: {first.get('msg', 'invalid request')}", 422)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        return _body("HTTP_ERROR", str(exc.detail), exc.status_code)
