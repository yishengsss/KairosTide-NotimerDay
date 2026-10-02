from typing import Any

from fastapi import APIRouter

from kairos.application.schedule import REMINDER_LEAD_SECONDS
from kairos.domain.events import Occurrence

from .. import dto
from ..deps import IdempotencyKey, ServicesDep

router = APIRouter(tags=["schedule"])
ERRORS: dict[int | str, dict[str, Any]] = {status: {"model": dto.ErrorResponse} for status in (404, 409, 422)}


def occurrence(item: Occurrence) -> dto.Occurrence:
    return dto.Occurrence(occurrence_id=item.occurrence_id, event_id=item.event_id, title=item.title,
                          location=item.location, start_at=item.start_at, end_at=item.end_at,
                          version=item.version, disposition=item.disposition)


@router.get("/state", response_model=dto.ScheduleState)
def state(svc: ServicesDep) -> dto.ScheduleState:
    snapshot = svc.schedule.state(svc.owner_id)
    return dto.ScheduleState(
        server_now=snapshot.now, active=[occurrence(item) for item in snapshot.active],
        reminders=[occurrence(item) for item in snapshot.reminders],
        conflicts=[list(group) for group in snapshot.conflicts], state_revision=snapshot.revision,
        next_transition_at=snapshot.next_transition_at, reminder_lead_seconds=REMINDER_LEAD_SECONDS)


@router.post("/reminders/{occurrence_id}/ack", response_model=dto.ReminderAck, responses=ERRORS)
def acknowledge(occurrence_id: str, body: dto.ReminderAckRequest, key: IdempotencyKey,
                svc: ServicesDep) -> dto.ReminderAck:
    result = svc.schedule.acknowledge_reminder(svc.owner_id, occurrence_id, body.occurrence_version, key)
    return dto.ReminderAck(occurrence_id=result.occurrence_id, occurrence_version=result.occurrence_version,
                           acknowledged_at=result.acknowledged_at)


@router.post("/occurrences/{occurrence_id}/exception", response_model=dto.Occurrence, responses=ERRORS)
def exception(occurrence_id: str, body: dto.ExceptionRequest, key: IdempotencyKey,
              svc: ServicesDep) -> dto.Occurrence:
    return occurrence(svc.schedule.excuse(svc.owner_id, occurrence_id, body.expected_version, key))


@router.post("/conflict-decisions", response_model=dto.ConflictDecision, responses=ERRORS)
def decide(body: dto.ConflictDecisionRequest, key: IdempotencyKey, svc: ServicesDep) -> dto.ConflictDecision:
    result = svc.schedule.decide_conflict(svc.owner_id, body.group, body.chosen_occurrence_id,
                                          body.state_revision, key)
    return dto.ConflictDecision(chosen_occurrence_id=result.chosen_occurrence_id,
                                missed_occurrence_ids=list(result.missed_occurrence_ids),
                                state_revision=result.state_revision)
