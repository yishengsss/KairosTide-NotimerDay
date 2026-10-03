"""Proposals that act on a flexible task: create, change title/deadline, cancel. Validation only.

The stance is the create path's, not the event-change path's: a flexible task has no slot and no
series, so none of the occurrence machinery applies. The refusals here are M3 plan §2.3:

1. The title must be quoted from the user, so the model cannot turn "我最近好累" into a "休息" task.
2. A negated or hypothetical sentence makes no draft ("别加任务了", "如果我要背单词").
3. An `instant` deadline needs a clock time in the quoted words; "周日前" alone can only be `date`.
4. One task per call: each draft quotes its own basis, so five tasks need five calls with five bases.
5. Change and cancel act only on a task this turn's lookup returned, never a remembered or guessed ID.

Lifecycle is deliberately absent: there is no model tool for planned/active/done (rule 6). The user
presses a button; the model has nothing to call.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from kairos.domain.draft import DraftFields, DraftKind, parse_fields
from kairos.domain.tasks import FlexibleTask, TaskTarget

from ..ports import UnitOfWork
from . import tools as whitelist

CREATE_TASK_DRAFT = "create_flexible_task_draft"
PROPOSE_TASK_CHANGE = "propose_task_change"
PROPOSE_TASK_CANCEL = "propose_task_cancel"

TASK_WRITE_TOOLS = frozenset({CREATE_TASK_DRAFT, PROPOSE_TASK_CHANGE, PROPOSE_TASK_CANCEL})
TASK_CHANGE_TOOLS = frozenset({PROPOSE_TASK_CHANGE, PROPOSE_TASK_CANCEL})

KIND_BY_TOOL: Mapping[str, DraftKind] = {
    CREATE_TASK_DRAFT: "task_create",
    PROPOSE_TASK_CHANGE: "task_change",
    PROPOSE_TASK_CANCEL: "task_cancel",
}


@dataclass(frozen=True)
class TaskProposal:
    kind: DraftKind
    fields: DraftFields
    target: TaskTarget | None


def _deadline_basis_problem(fields: DraftFields, fragments: Sequence[str]) -> str | None:
    """An `instant` deadline must rest on a clock time the user actually said (rule 3)."""
    if fields.precision != "instant":
        return None
    if any(whitelist.says_clock_time(fragment) for fragment in fragments):
        return None
    return ("截止精度是 instant，但引用的话里没有用户说出的钟点。只说到某天请用 date，"
            "说了具体时刻才用 instant，并把那句话原样摘进 basis_phrases")


def propose_create(args: Mapping[str, Any], fragments: Sequence[str]) -> tuple[TaskProposal | None, str | None]:
    """Build a task_create draft's content, or say why not. Title sufficiency is checked downstream."""
    fields, problems = parse_fields(args)
    if problems:
        return None, "；".join(problems)
    unbacked = _deadline_basis_problem(fields, fragments)
    if unbacked is not None:
        return None, unbacked
    return TaskProposal("task_create", fields, None), None


def propose_change(uow: UnitOfWork, owner_id: str, tool: str, args: Mapping[str, Any],
                   fragments: Sequence[str], queried: Mapping[str, int]
                   ) -> tuple[TaskProposal | None, str | None]:
    """Change or cancel a task. `queried` maps task IDs this turn looked up to their versions (rule 5)."""
    kind = KIND_BY_TOOL[tool]
    task_id = args.get("task_id")
    if not isinstance(task_id, str) or task_id not in queried:
        return None, "只能改动本轮查到的柔性任务，请先查询再提出"
    task = uow.tasks.get_task(owner_id, task_id)
    if task is None:
        return None, "这条任务已经不存在了"
    if task.version != queried[task_id]:
        return None, "这条任务刚刚变过，请重新查询再改"
    if kind == "task_cancel":
        return TaskProposal(kind, _snapshot_fields(task), _target(task)), None
    changed, problem = _changed_fields(args, task, fragments)
    if changed is None:
        return None, problem
    return TaskProposal(kind, changed, _target(task)), None


def _changed_fields(args: Mapping[str, Any], task: FlexibleTask,
                    fragments: Sequence[str]) -> tuple[DraftFields | None, str | None]:
    parsed, problems = parse_fields({key: args.get(key) for key in ("title", "deadline", "precision")})
    if problems:
        return None, "；".join(problems)
    unbacked = _deadline_basis_problem(parsed, fragments)
    if unbacked is not None:
        return None, unbacked
    title = parsed.title or task.title
    # A deadline is only touched when the user gave one; absence means "leave it", not "clear it".
    gave_deadline = parsed.deadline is not None
    deadline = parsed.deadline if gave_deadline else task.deadline
    precision = parsed.precision if gave_deadline else task.precision
    after = DraftFields(title, task.timezone, None, None, deadline=deadline, precision=precision)
    if title == task.title and deadline == task.deadline and precision == task.precision:
        return None, "没有要改的内容。请只填写用户要改的字段"
    return after, None


def _snapshot_fields(task: FlexibleTask) -> DraftFields:
    return DraftFields(task.title, task.timezone, None, None, deadline=task.deadline, precision=task.precision)


def _target(task: FlexibleTask) -> TaskTarget:
    return TaskTarget(task_id=task.task_id, task_version=task.version, title=task.title,
                      deadline=task.deadline, precision=task.precision)
