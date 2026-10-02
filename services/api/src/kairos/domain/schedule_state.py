"""Pure projection of 'what is happening now' from occurrences, acknowledgements and an instant.

Reminders are derived, never stored: an instance is due when it is scheduled, starts within the
lead window, and its current version has not been acknowledged.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta

from .conflicts import conflict_groups, state_revision
from .events import Occurrence
from .time_rules import is_active

REMINDER_LEAD = timedelta(minutes=5)


@dataclass(frozen=True)
class ScheduleState:
    now: datetime
    active: tuple[Occurrence, ...]
    reminders: tuple[Occurrence, ...]
    conflicts: tuple[tuple[str, ...], ...]
    revision: int
    next_transition_at: datetime | None


def is_due_for_reminder(item: Occurrence, now: datetime, lead: timedelta = REMINDER_LEAD) -> bool:
    return item.disposition == "scheduled" and timedelta(0) < item.start_at - now <= lead


def project(occurrences: Iterable[Occurrence], acknowledged: set[tuple[str, int]], now: datetime,
            lead: timedelta = REMINDER_LEAD) -> ScheduleState:
    if now.tzinfo is None:
        raise ValueError("now must be timezone aware")
    scheduled = [item for item in occurrences if item.disposition == "scheduled"]
    active = tuple(item for item in scheduled if is_active(item.start_at, item.end_at, now))
    reminders = tuple(
        item for item in scheduled
        if is_due_for_reminder(item, now, lead) and (item.occurrence_id, item.version) not in acknowledged
    )
    boundaries: list[datetime] = [item.end_at for item in active]
    for item in scheduled:
        if item.start_at > now:
            boundaries.append(item.start_at)
            if item.start_at - lead > now:
                boundaries.append(item.start_at - lead)
    return ScheduleState(now=now, active=active, reminders=reminders, conflicts=conflict_groups(active),
                         revision=state_revision(active), next_transition_at=min(boundaries, default=None))
