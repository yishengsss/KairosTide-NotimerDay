"""Local calendar expansion with explicit DST policy and immutable slot keys.

Provenance: KairosTide domain/recurrence.py @7babbaa. Changed: ends_on is now mandatory in the
rule itself (was validated at expansion time); materialize() overlays persisted instance state.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .events import EventSeries, Occurrence, OccurrenceState
from .identity import occurrence_id
from .time_rules import overlaps

MAX_WINDOW = timedelta(days=370)
# How far a single instance may be moved from its slot. Expansion looks this far beyond the window so
# an instance moved into the window is still found.
MAX_MOVE = timedelta(days=14)


class NeedsDSTPolicy(ValueError):
    pass


@dataclass(frozen=True)
class Slot:
    original_slot: str
    start_at: datetime
    end_at: datetime


def resolve_local(value: datetime, zone: ZoneInfo, gap_policy: str | None, fold_policy: str | None) -> datetime | None:
    choices: list[datetime] = []
    for fold in (0, 1):
        candidate = value.replace(tzinfo=zone, fold=fold)
        if candidate.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == value and all(
            previous.utcoffset() != candidate.utcoffset() for previous in choices
        ):
            choices.append(candidate)
    if not choices:
        if gap_policy == "skip":
            return None
        raise NeedsDSTPolicy("nonexistent local time needs explicit skip")
    if len(choices) == 1:
        return choices[0]
    if fold_policy not in ("earlier", "later"):
        raise NeedsDSTPolicy("ambiguous local time needs earlier or later")
    choices.sort(key=lambda choice: choice.astimezone(UTC))
    return choices[0] if fold_policy == "earlier" else choices[-1]


def zone_of(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("invalid IANA timezone") from error


def expand_slots(event: EventSeries, window_start: datetime, window_end: datetime,
                 max_window: timedelta = MAX_WINDOW) -> list[Slot]:
    if window_start.tzinfo is None or window_end.tzinfo is None or window_end <= window_start:
        raise ValueError("query window must be an aware positive interval")
    if window_end - window_start > max_window:
        raise ValueError("query window too large; page the query")
    if event.recurrence is None:
        if overlaps(event.start_at, event.end_at, window_start, window_end):
            return [Slot("single", event.start_at.astimezone(UTC), event.end_at.astimezone(UTC))]
        return []
    rule = event.recurrence
    zone = zone_of(event.timezone)
    first = max(rule.starts_on, window_start.astimezone(zone).date() - timedelta(days=1))
    last = min(rule.ends_on, window_end.astimezone(zone).date() + timedelta(days=1))
    slots: list[Slot] = []
    day = first
    while day <= last:
        if rule.frequency == "daily" or day.isoweekday() in rule.weekdays:
            local_start = datetime.combine(day, rule.local_start)
            local_end = datetime.combine(day + timedelta(days=rule.end_day_offset), rule.local_end)
            start = resolve_local(local_start, zone, rule.gap_policy, rule.fold_policy)
            end = resolve_local(local_end, zone, rule.gap_policy, rule.fold_policy)
            if start is not None and end is not None:
                start_at, end_at = start.astimezone(UTC), end.astimezone(UTC)
                if end_at <= start_at:
                    raise ValueError("recurring local end must follow start")
                if overlaps(start_at, end_at, window_start, window_end):
                    slots.append(Slot(day.isoformat(), start_at, end_at))
        day += timedelta(days=1)
    return slots


def slot_for(event: EventSeries, original_slot: str) -> Slot | None:
    """The unmoved times of one slot, or None if the series no longer produces it."""
    if event.recurrence is None:
        return Slot("single", event.start_at.astimezone(UTC), event.end_at.astimezone(UTC)) \
            if original_slot == "single" else None
    try:
        day = date.fromisoformat(original_slot)
    except ValueError:
        return None
    zone = zone_of(event.timezone)
    start = datetime.combine(day - timedelta(days=1), time(0), zone).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=3), time(0), zone).astimezone(UTC)
    return next((slot for slot in expand_slots(event, start, end) if slot.original_slot == original_slot), None)


def occurrence_at(event: EventSeries, slot: Slot, state: OccurrenceState | None) -> Occurrence:
    """One instance: the slot's times and the series' text, with any confirmed one-off override on top."""
    start_at = state.start_at if state and state.start_at else slot.start_at
    end_at = state.end_at if state and state.end_at else slot.end_at
    return Occurrence(
        occurrence_id=occurrence_id(event.event_id, slot.original_slot), event_id=event.event_id,
        owner_id=event.owner_id, original_slot=slot.original_slot, start_at=start_at.astimezone(UTC),
        end_at=end_at.astimezone(UTC), title=state.title if state and state.title else event.title,
        location=state.location if state and state.location else event.location,
        version=state.version if state else 1, disposition=state.disposition if state else "scheduled")


def materialize(events: list[EventSeries], states: Mapping[str, OccurrenceState],
                window_start: datetime, window_end: datetime) -> list[Occurrence]:
    """Expand series into occurrences without writing anything. One-off overrides are applied here."""
    if window_end - window_start > MAX_WINDOW:
        raise ValueError("query window too large; page the query")
    padded_start, padded_end = window_start - MAX_MOVE, window_end + MAX_MOVE
    result: list[Occurrence] = []
    for event in events:
        for slot in expand_slots(event, padded_start, padded_end, MAX_WINDOW + 2 * MAX_MOVE):
            item = occurrence_at(event, slot, states.get(occurrence_id(event.event_id, slot.original_slot)))
            if overlaps(item.start_at, item.end_at, window_start, window_end):
                result.append(item)
    result.sort(key=lambda item: (item.start_at, item.occurrence_id))
    return result
