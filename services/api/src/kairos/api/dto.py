"""HTTP request/response models. These are the source of contracts/openapi.json."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Health(Strict):
    status: Literal["ok"]


class Occurrence(Strict):
    occurrence_id: str
    event_id: str
    title: str
    location: str | None
    start_at: datetime
    end_at: datetime
    version: int
    disposition: Literal["scheduled", "excused", "missed", "cancelled"]


class ScheduleState(Strict):
    server_now: datetime
    active: list[Occurrence]
    reminders: list[Occurrence] = Field(description="Scheduled instances starting within the lead window, "
                                                    "not yet acknowledged at their current version.")
    conflicts: list[list[str]]
    state_revision: int
    next_transition_at: datetime | None
    reminder_lead_seconds: int


class ReminderAckRequest(Strict):
    occurrence_version: int = Field(ge=1)


class ReminderAck(Strict):
    occurrence_id: str
    occurrence_version: int
    acknowledged_at: datetime


class ExceptionRequest(Strict):
    expected_version: int = Field(ge=1)


class ConflictDecisionRequest(Strict):
    group: list[str] = Field(min_length=2, max_length=20)
    chosen_occurrence_id: str
    state_revision: int


class ConflictDecision(Strict):
    chosen_occurrence_id: str
    missed_occurrence_ids: list[str]
    state_revision: int


class SceneWeatherValues(Strict):
    condition: Literal["clear", "partly_cloudy", "overcast", "fog", "drizzle", "rain", "snow", "thunderstorm"]
    cloud: float = Field(ge=0, le=1)
    rain: float = Field(ge=0, le=1)
    snow: float = Field(ge=0, le=1)
    fog: float = Field(ge=0, le=1)
    wind: float = Field(ge=0, le=1)
    thunder: bool


class SceneWeather(Strict):
    availability: Literal["available", "unavailable"]
    weather: SceneWeatherValues | None
    observed_at: datetime | None
    fetched_at: datetime
    source: str
    attribution: str


class Place(Strict):
    name: str
    latitude: float
    longitude: float
    timezone: str
    country: str | None
    admin1: str | None


class PlaceList(Strict):
    items: list[Place]


class ConflictPair(Strict):
    slot: str
    occurrence_id: str


class ErrorBody(Strict):
    code: str
    message: str
    conflicts: list[ConflictPair] | None = Field(
        default=None, description="CONFLICT_REVIEW_REQUIRED only: candidate slot vs saved occurrence.")
    acceptance_token: str | None = Field(
        default=None, description="CONFLICT_REVIEW_REQUIRED only: send back to save despite the overlap.")
    superseded_by: str | None = Field(default=None, description="DRAFT_SUPERSEDED only.")


class ErrorResponse(Strict):
    error: ErrorBody
