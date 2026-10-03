"""Request-scoped access to the services assembled in bootstrap."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request

from kairos.application.assistant.conversation import AssistantService
from kairos.application.assistant.drafts import DraftService
from kairos.application.schedule import ScheduleService
from kairos.application.tasks import TaskService
from kairos.application.weather import WeatherService


@dataclass(frozen=True)
class Services:
    owner_id: str
    schedule: ScheduleService
    weather: WeatherService
    assistant: AssistantService
    drafts: DraftService
    tasks: TaskService
    assistant_available: bool


def services(request: Request) -> Services:
    value: Services = request.app.state.services
    return value


ServicesDep = Annotated[Services, Depends(services)]
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]
