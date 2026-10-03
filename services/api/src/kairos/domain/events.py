"""Event facts: a series defines timing; an occurrence carries the user's disposition.

Provenance: KairosTide domain/events.py @7babbaa. Changed: Occurrence drops schedule_revision
(one version counter per instance) and gains event_id/original_slot as identity inputs.
"""

from dataclasses import dataclass, replace
from datetime import date, datetime, time
from typing import Literal

# excused: the user took leave. missed: lost a conflict choice. cancelled: the user deleted this one instance.
Disposition = Literal["scheduled", "excused", "missed", "cancelled"]
Frequency = Literal["daily", "weekly"]


@dataclass(frozen=True)
class RecurrenceRule:
    frequency: Frequency
    starts_on: date
    ends_on: date
    weekdays: tuple[int, ...]
    local_start: time
    local_end: time
    end_day_offset: int = 0
    gap_policy: Literal["skip"] | None = None
    fold_policy: Literal["earlier", "later"] | None = None

    def __post_init__(self) -> None:
        if self.frequency not in ("daily", "weekly"):
            raise ValueError("unsupported recurrence frequency")
        if self.ends_on < self.starts_on or self.end_day_offset not in (0, 1):
            raise ValueError("invalid recurrence range or day offset")
        if self.frequency == "weekly" and (not self.weekdays or any(day < 1 or day > 7 for day in self.weekdays)):
            raise ValueError("weekly recurrence needs ISO weekdays")
        if self.gap_policy not in (None, "skip") or self.fold_policy not in (None, "earlier", "later"):
            raise ValueError("invalid DST policy")


@dataclass(frozen=True)
class EventSeries:
    event_id: str
    owner_id: str
    version: int
    title: str
    location: str | None
    timezone: str
    start_at: datetime
    end_at: datetime
    recurrence: RecurrenceRule | None = None


@dataclass(frozen=True)
class OccurrenceState:
    """Persisted user facts about one instance. Absent row means scheduled, version 1.

    The override fields hold a confirmed one-off change ("only this time, at four"). None means the
    series value applies. The slot identity never moves, so a moved instance keeps its ID.
    """

    occurrence_id: str
    version: int
    disposition: Disposition
    title: str | None = None
    location: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None

    def advanced(self, disposition: Disposition) -> "OccurrenceState":
        """The next version with a new disposition. Overrides are kept."""
        return replace(self, version=self.version + 1, disposition=disposition)


def first_state(occurrence_id: str) -> OccurrenceState:
    """The implicit state of an instance nobody has touched yet."""
    return OccurrenceState(occurrence_id, 1, "scheduled")


@dataclass(frozen=True)
class Occurrence:
    occurrence_id: str
    event_id: str
    owner_id: str
    original_slot: str
    start_at: datetime
    end_at: datetime
    title: str
    location: str | None
    version: int
    disposition: Disposition
