"""HTTP models for flexible tasks."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from .dto import Strict

Lifecycle = Literal["planned", "active", "done"]


class FlexibleTask(Strict):
    task_id: str
    version: int
    title: str
    timezone: str
    lifecycle: Lifecycle
    deadline: datetime | None
    precision: Literal["date", "instant"] | None
    urgency: str
    overdue: bool


class TaskList(Strict):
    server_now: datetime
    items: list[FlexibleTask]


class LifecycleRequest(Strict):
    target: Lifecycle
    expected_version: int = Field(ge=1)


class LifecycleResult(Strict):
    task_id: str
    lifecycle: Lifecycle
    version: int
