"""Rigid-event use cases: read the current state and record explicit user decisions."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from kairos.domain.events import Disposition, Occurrence, first_state
from kairos.domain.recurrence import materialize
from kairos.domain.schedule_state import REMINDER_LEAD, ScheduleState, project

from .errors import InvalidRequest, NotFound, VersionConflict
from .idempotency import once
from .ports import Clock, UnitOfWork, UnitOfWorkFactory

STATE_WINDOW_BEFORE = timedelta(days=1)
STATE_WINDOW_AFTER = timedelta(days=1)
LOOKUP_WINDOW_AFTER = timedelta(days=14)
REMINDER_LEAD_SECONDS = int(REMINDER_LEAD.total_seconds())


@dataclass(frozen=True)
class AckResult:
    occurrence_id: str
    occurrence_version: int
    acknowledged_at: datetime


@dataclass(frozen=True)
class ConflictDecision:
    chosen_occurrence_id: str
    missed_occurrence_ids: tuple[str, ...]
    state_revision: int


def _occurrences(uow: UnitOfWork, owner_id: str, start: datetime, end: datetime) -> list[Occurrence]:
    return materialize(uow.events.list_series(owner_id), uow.occurrences.states(owner_id), start, end)


def _find(uow: UnitOfWork, owner_id: str, occurrence_id: str, now: datetime) -> Occurrence:
    for item in _occurrences(uow, owner_id, now - STATE_WINDOW_BEFORE, now + LOOKUP_WINDOW_AFTER):
        if item.occurrence_id == occurrence_id:
            return item
    raise NotFound("occurrence not found")


def _occurrence_json(item: Occurrence) -> dict[str, Any]:
    return {"occurrence_id": item.occurrence_id, "event_id": item.event_id, "original_slot": item.original_slot,
            "start_at": item.start_at.isoformat(), "end_at": item.end_at.isoformat(), "title": item.title,
            "location": item.location, "version": item.version, "disposition": item.disposition,
            "owner_id": item.owner_id}


def _occurrence_from_json(data: dict[str, Any]) -> Occurrence:
    return Occurrence(occurrence_id=data["occurrence_id"], event_id=data["event_id"], owner_id=data["owner_id"],
                      original_slot=data["original_slot"], start_at=datetime.fromisoformat(data["start_at"]),
                      end_at=datetime.fromisoformat(data["end_at"]), title=data["title"],
                      location=data["location"], version=data["version"], disposition=data["disposition"])


class ScheduleService:
    def __init__(self, uow: UnitOfWorkFactory, clock: Clock) -> None:
        self._uow = uow
        self._clock = clock

    def state(self, owner_id: str) -> ScheduleState:
        """Read-only: never writes, so GET /state can be polled freely."""
        now = self._clock.now()
        with self._uow(write=False) as uow:
            items = _occurrences(uow, owner_id, now - STATE_WINDOW_BEFORE, now + STATE_WINDOW_AFTER)
            return project(items, uow.acks.acknowledged(owner_id), now)

    def acknowledge_reminder(self, owner_id: str, occurrence_id: str, occurrence_version: int,
                             key: str) -> AckResult:
        now = self._clock.now()
        payload = {"occurrence_id": occurrence_id, "occurrence_version": occurrence_version}
        with self._uow(write=True) as uow:
            def act() -> dict[str, Any]:
                item = _find(uow, owner_id, occurrence_id, now)
                if item.version != occurrence_version:
                    raise VersionConflict("occurrence changed since the reminder was shown")
                # A tap that lands just after the start still counts; only premature or moot acks are rejected.
                if item.disposition != "scheduled" or item.start_at - now > REMINDER_LEAD:
                    raise InvalidRequest("this occurrence has no pending reminder")
                if (occurrence_id, occurrence_version) not in uow.acks.acknowledged(owner_id):
                    uow.acks.add(owner_id, occurrence_id, occurrence_version, now)
                uow.audit.record(owner_id, "reminder_ack", occurrence_id, now)
                return {"occurrence_id": occurrence_id, "occurrence_version": occurrence_version,
                        "acknowledged_at": now.isoformat()}

            result = once(uow, owner_id, "reminder_ack", key, payload, act, now)
            uow.commit()
        return AckResult(result["occurrence_id"], result["occurrence_version"],
                         datetime.fromisoformat(result["acknowledged_at"]))

    def excuse(self, owner_id: str, occurrence_id: str, expected_version: int, key: str) -> Occurrence:
        """Record leave for this one instance only. The series and its other instances are untouched."""
        now = self._clock.now()
        payload = {"occurrence_id": occurrence_id, "expected_version": expected_version}
        with self._uow(write=True) as uow:
            def act() -> dict[str, Any]:
                item = _find(uow, owner_id, occurrence_id, now)
                if item.version != expected_version:
                    raise VersionConflict("occurrence changed")
                if item.disposition != "scheduled":
                    raise VersionConflict("occurrence already has a disposition")
                updated = self._set(uow, owner_id, item, "excused", now)
                uow.audit.record(owner_id, "occurrence_excused", occurrence_id, now)
                return _occurrence_json(updated)

            result = once(uow, owner_id, "occurrence_exception", key, payload, act, now)
            uow.commit()
        return _occurrence_from_json(result)

    def decide_conflict(self, owner_id: str, group: list[str], chosen_occurrence_id: str, state_revision: int,
                        key: str) -> ConflictDecision:
        """The user picked one member of a current conflict group; the others become missed."""
        now = self._clock.now()
        members = sorted(set(group))
        payload = {"group": members, "chosen": chosen_occurrence_id, "state_revision": state_revision}
        with self._uow(write=True) as uow:
            def act() -> dict[str, Any]:
                items = _occurrences(uow, owner_id, now - STATE_WINDOW_BEFORE, now + STATE_WINDOW_AFTER)
                current = project(items, set(), now)
                if current.revision != state_revision:
                    raise VersionConflict("the active schedule changed; review the current conflict")
                if tuple(members) not in current.conflicts or chosen_occurrence_id not in members:
                    raise VersionConflict("these occurrences are not a current conflict group")
                by_id = {item.occurrence_id: item for item in current.active}
                missed = [identity for identity in members if identity != chosen_occurrence_id]
                for identity in missed:
                    self._set(uow, owner_id, by_id[identity], "missed", now)
                    uow.audit.record(owner_id, "occurrence_missed_by_choice", identity, now)
                after = project(_occurrences(uow, owner_id, now - STATE_WINDOW_BEFORE, now + STATE_WINDOW_AFTER),
                                set(), now)
                return {"chosen": chosen_occurrence_id, "missed": missed, "state_revision": after.revision}

            result = once(uow, owner_id, "conflict_decision", key, payload, act, now)
            uow.commit()
        return ConflictDecision(result["chosen"], tuple(result["missed"]), result["state_revision"])

    @staticmethod
    def _set(uow: UnitOfWork, owner_id: str, item: Occurrence, disposition: Disposition, now: datetime) -> Occurrence:
        current = uow.occurrences.states(owner_id).get(item.occurrence_id) or first_state(item.occurrence_id)
        state = current.advanced(disposition)
        uow.occurrences.save(owner_id, item.event_id, state, item.version, now)
        return Occurrence(**{**item.__dict__, "version": state.version, "disposition": disposition})
