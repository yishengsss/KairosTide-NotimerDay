"""Planning a flexible-task write within a turn, kept out of conversation.py so neither file overflows.

The split mirrors the event path: validation lives in `task_proposals`, the turn loop in
`conversation`, and this thin seam turns a validated proposal into everything the service needs to
store a draft — fields, kind, target, status and the sentence shown above the card. It never writes;
storage stays with the service so the single-writer discipline holds.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from kairos.domain.draft import DraftFields, DraftKind, DraftStatus, initial_status
from kairos.domain.tasks import TaskTarget

from ..ports import UnitOfWork
from . import task_proposals
from .prompts import task_draft_notice


@dataclass(frozen=True)
class TaskDraftPlan:
    fields: DraftFields
    kind: DraftKind
    target: TaskTarget | None
    status: DraftStatus
    notice: str


def plan_task_draft(uow: UnitOfWork, owner_id: str, tool: str, args: Mapping[str, object],
                    fragments: Sequence[str], queried_tasks: Mapping[str, int]
                    ) -> tuple[TaskDraftPlan | None, str | None]:
    """A validated proposal turned into a storable plan, or the reason it was refused."""
    if tool == task_proposals.CREATE_TASK_DRAFT:
        proposal, problem = task_proposals.propose_create(args, fragments)
    else:
        proposal, problem = task_proposals.propose_change(uow, owner_id, tool, args, fragments, queried_tasks)
    if proposal is None:
        return None, problem
    status = initial_status(proposal.fields, proposal.kind)
    missing = proposal.fields.missing(proposal.kind)
    return TaskDraftPlan(proposal.fields, proposal.kind, proposal.target, status,
                         task_draft_notice(status, proposal.kind, missing)), None
