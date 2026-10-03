"""Flexible tasks over HTTP. Reading is free; lifecycle moves only on a user's button press (plan rule 6)."""

from typing import Any

from fastapi import APIRouter

from kairos.domain.tasks import urgency

from .. import dto
from .. import task_dto as tdto
from ..deps import IdempotencyKey, ServicesDep

router = APIRouter(tags=["tasks"])
ERRORS: dict[int | str, dict[str, Any]] = {status: {"model": dto.ErrorResponse} for status in (404, 409, 422)}


@router.get("/tasks", response_model=tdto.TaskList)
def list_tasks(svc: ServicesDep) -> tdto.TaskList:
    now = svc.tasks.now()
    items = [tdto.FlexibleTask(task_id=task.task_id, version=task.version, title=task.title,
                               timezone=task.timezone, lifecycle=task.lifecycle, deadline=task.deadline,
                               precision=task.precision, urgency=urgency(task, now), overdue=task.overdue(now))
             for task in svc.tasks.list_tasks(svc.owner_id)]
    return tdto.TaskList(server_now=now, items=items)


@router.post("/tasks/{task_id}/lifecycle", response_model=tdto.LifecycleResult, responses=ERRORS)
def transition(task_id: str, body: tdto.LifecycleRequest, key: IdempotencyKey,
               svc: ServicesDep) -> tdto.LifecycleResult:
    result = svc.tasks.transition(svc.owner_id, task_id, body.target, body.expected_version, key)
    return tdto.LifecycleResult(**result)
