from typing import Annotated, Any

from fastapi import APIRouter, Query

from kairos.application.errors import InvalidRequest
from kairos.application.image_input import ImageValidationError, validate_image

from .. import assistant_dto as dto
from ..deps import IdempotencyKey, ServicesDep
from ..dto import ErrorResponse

router = APIRouter(tags=["assistant"])
ERRORS: dict[int | str, dict[str, Any]] = {status: {"model": ErrorResponse} for status in (404, 409, 413, 422, 503)}


@router.get("/assistant/status", response_model=dto.AssistantStatus)
def status(svc: ServicesDep) -> dto.AssistantStatus:
    """Whether a model is configured. Says nothing else about it; the key never leaves the server."""
    return dto.AssistantStatus(available=svc.assistant_available)


@router.post("/conversations", response_model=dto.ConversationCreated, status_code=201, responses=ERRORS)
def start(svc: ServicesDep) -> dto.ConversationCreated:
    return dto.ConversationCreated.model_validate(svc.assistant.start(svc.owner_id))


@router.get("/conversations/{conversation_id}/messages", response_model=dto.MessagePage, responses=ERRORS)
def history(conversation_id: str, svc: ServicesDep,
            cursor: Annotated[int, Query(ge=-1)] = -1) -> dto.MessagePage:
    page = svc.assistant.history(svc.owner_id, conversation_id, cursor)
    return dto.MessagePage(conversation_id=page.conversation_id, revision=page.revision,
                           items=[dto.Message.model_validate(item) for item in page.items],
                           next_cursor=page.next_cursor, pending_client_message_id=page.pending_client_message_id,
                           draft=dto.Draft.model_validate(page.draft) if page.draft else None)


@router.post("/conversations/{conversation_id}/messages", response_model=dto.TurnResult, responses=ERRORS)
def send(conversation_id: str, body: dto.SendMessageRequest, svc: ServicesDep) -> dto.TurnResult:
    image = None
    if body.image is not None:
        try:
            image = validate_image(body.image.mime_type, body.image.data_base64)
        except ImageValidationError as error:
            raise InvalidRequest(f"图片无法使用：{error}") from None
    result = svc.assistant.send(svc.owner_id, conversation_id, body.client_message_id, body.content,
                                body.timezone, body.expected_revision, image)
    return dto.TurnResult.model_validate(result.to_json())


@router.get("/drafts/{draft_id}", response_model=dto.Draft, responses=ERRORS)
def draft(draft_id: str, svc: ServicesDep) -> dto.Draft:
    return dto.Draft.model_validate(svc.assistant.draft_view(svc.owner_id, draft_id))


@router.post("/drafts/{draft_id}/commit", response_model=dto.CommitResult, responses=ERRORS)
def commit(draft_id: str, body: dto.CommitRequest, key: IdempotencyKey, svc: ServicesDep) -> dto.CommitResult:
    result = svc.drafts.commit(svc.owner_id, draft_id, body.digest, key, body.conflict_acceptance)
    return dto.CommitResult.model_validate(result.to_json())


@router.post("/drafts/{draft_id}/discard", response_model=dto.DiscardResult, responses=ERRORS)
def discard(draft_id: str, key: IdempotencyKey, svc: ServicesDep) -> dto.DiscardResult:
    return dto.DiscardResult.model_validate(svc.drafts.discard(svc.owner_id, draft_id, key))
