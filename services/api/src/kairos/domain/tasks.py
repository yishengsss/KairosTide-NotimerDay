"""Flexible task facts: something the user wants to get done, with no fixed start time.

Provenance: KairosTide domain/tasks.py @7babbaa, reworked. Changed: the lifecycle gains an undo of
completion (M3 plan §2.2), the deadline carries its own precision so "周日前" is never shown as
"周日 23:59", and overdue is derived rather than stored.

A task has no occurrences and no recurrence, so none of the slot machinery applies. What it does
share with events is the confirm-before-write path: the model proposes, the user confirms.
"""

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import Any, Literal

from .recurrence import zone_of

Lifecycle = Literal["planned", "active", "done"]
# date: the user named a day ("周日前"). instant: the user named a clock time ("周五下午六点前").
Precision = Literal["date", "instant"]

MAX_TASK_TITLE = 120

# planned <-> active is the user picking a task up and putting it down. Completion can be undone, but
# it goes back to active rather than planned: the user did work on it.
TRANSITIONS: dict[Lifecycle, tuple[Lifecycle, ...]] = {
    "planned": ("active", "done"),
    "active": ("planned", "done"),
    "done": ("active",),
}

_SPACE = re.compile(r"\s+")


def normalized_title(title: str) -> str:
    """For finding "背单词" when the user types "背 单词". Never shown to the user."""
    return _SPACE.sub("", title).casefold()


def valid_transition(current: Lifecycle, target: Lifecycle) -> bool:
    return target in TRANSITIONS[current]


def resolve_deadline(day: date, timezone: str) -> datetime:
    """"周日前" means the end of that local day, not midnight at its start."""
    return datetime.combine(day, time(23, 59, 59), tzinfo=zone_of(timezone)).astimezone(UTC)


@dataclass(frozen=True)
class FlexibleTask:
    task_id: str
    owner_id: str
    version: int
    title: str
    timezone: str
    lifecycle: Lifecycle
    deadline: datetime | None = None
    precision: Precision | None = None
    source_message_id: str | None = None

    def __post_init__(self) -> None:
        if not self.title:
            raise ValueError("task needs a title")
        if (self.deadline is None) != (self.precision is None):
            raise ValueError("a deadline and its precision go together")

    def overdue(self, now: datetime) -> bool:
        return self.deadline is not None and now > self.deadline

    def shows_in_scene(self) -> bool:
        """Done tasks leave the scene. Overdue ones stay: the user may still want to do them."""
        return self.lifecycle in ("planned", "active")


Urgency = Literal["none", "later", "soon", "today", "overdue"]


def urgency(task: FlexibleTask, now: datetime) -> Urgency:
    """How close the deadline is, in the user's own timezone. No deadline means no urgency at all."""
    if task.deadline is None:
        return "none"
    if now > task.deadline:
        return "overdue"
    zone = zone_of(task.timezone)
    days = (task.deadline.astimezone(zone).date() - now.astimezone(zone).date()).days
    if days <= 0:
        return "today"
    return "soon" if days <= 2 else "later"


@dataclass(frozen=True)
class TaskTarget:
    """The saved task a change or delete draft acts on, as the user was shown it.

    Commit compares the version against storage, so a change built on a stale view is refused.
    """

    task_id: str
    task_version: int
    title: str
    deadline: datetime | None
    precision: Precision | None

    def to_json(self) -> dict[str, Any]:
        return {"task_id": self.task_id, "task_version": self.task_version, "title": self.title,
                "deadline": self.deadline.isoformat() if self.deadline else None,
                "precision": self.precision}

    @staticmethod
    def from_json(raw: dict[str, Any]) -> "TaskTarget":
        deadline = raw.get("deadline")
        return TaskTarget(task_id=raw["task_id"], task_version=int(raw["task_version"]), title=raw["title"],
                          deadline=datetime.fromisoformat(deadline) if deadline else None,
                          precision=raw.get("precision"))
