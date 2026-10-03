"""One small repository per aggregate, all sharing the unit of work's connection."""

import json
import sqlite3
from collections.abc import Mapping
from datetime import date, datetime, time
from typing import Any

from kairos.application.errors import VersionConflict
from kairos.application.ports import StoredResult
from kairos.domain.events import EventSeries, OccurrenceState, RecurrenceRule


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("refusing to store a naive datetime")
    return value.isoformat()


def _rule_json(rule: RecurrenceRule | None) -> str | None:
    if rule is None:
        return None
    return json.dumps({
        "frequency": rule.frequency, "starts_on": rule.starts_on.isoformat(), "ends_on": rule.ends_on.isoformat(),
        "weekdays": list(rule.weekdays), "local_start": rule.local_start.isoformat(),
        "local_end": rule.local_end.isoformat(), "end_day_offset": rule.end_day_offset,
        "gap_policy": rule.gap_policy, "fold_policy": rule.fold_policy,
    })


def _rule_from(raw: str | None) -> RecurrenceRule | None:
    if raw is None:
        return None
    data: dict[str, Any] = json.loads(raw)
    return RecurrenceRule(
        frequency=data["frequency"], starts_on=date.fromisoformat(data["starts_on"]),
        ends_on=date.fromisoformat(data["ends_on"]), weekdays=tuple(data["weekdays"]),
        local_start=time.fromisoformat(data["local_start"]), local_end=time.fromisoformat(data["local_end"]),
        end_day_offset=data["end_day_offset"], gap_policy=data["gap_policy"], fold_policy=data["fold_policy"],
    )


class SqliteEventRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def list_series(self, owner_id: str) -> list[EventSeries]:
        rows = self._db.execute(
            "SELECT * FROM event_series WHERE owner_id = ? AND deleted = 0 ORDER BY event_id", (owner_id,))
        return [self._series(row) for row in rows]

    def get_series(self, owner_id: str, event_id: str) -> EventSeries | None:
        row = self._db.execute("SELECT * FROM event_series WHERE owner_id = ? AND event_id = ? AND deleted = 0",
                               (owner_id, event_id)).fetchone()
        return self._series(row) if row else None

    def update_series(self, series: EventSeries, expected_version: int) -> None:
        """Replace the series' content. Row-count guarded on the version the user was shown."""
        if series.version != expected_version + 1:
            raise ValueError("new version must follow the expected version")
        cursor = self._db.execute(
            """UPDATE event_series SET version = ?, title = ?, location = ?, start_at = ?, end_at = ?
               WHERE owner_id = ? AND event_id = ? AND version = ? AND deleted = 0""",
            (series.version, series.title, series.location, _iso(series.start_at), _iso(series.end_at),
             series.owner_id, series.event_id, expected_version))
        if cursor.rowcount != 1:
            raise VersionConflict("event changed concurrently")

    def delete_series(self, owner_id: str, event_id: str, expected_version: int) -> None:
        cursor = self._db.execute(
            "UPDATE event_series SET deleted = 1, version = version + 1"
            " WHERE owner_id = ? AND event_id = ? AND version = ? AND deleted = 0",
            (owner_id, event_id, expected_version))
        if cursor.rowcount != 1:
            raise VersionConflict("event changed concurrently")

    @staticmethod
    def _series(row: sqlite3.Row) -> EventSeries:
        return EventSeries(
            event_id=row["event_id"], owner_id=row["owner_id"], version=row["version"], title=row["title"],
            location=row["location"], timezone=row["timezone"], start_at=datetime.fromisoformat(row["start_at"]),
            end_at=datetime.fromisoformat(row["end_at"]), recurrence=_rule_from(row["recurrence_json"]),
        )

    def add_series(self, series: EventSeries, created_at: datetime) -> None:
        self._db.execute(
            """INSERT INTO event_series (event_id, owner_id, version, title, location, timezone, start_at, end_at,
               recurrence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (series.event_id, series.owner_id, series.version, series.title, series.location, series.timezone,
             _iso(series.start_at), _iso(series.end_at), _rule_json(series.recurrence), _iso(created_at)))


class SqliteOccurrenceStateRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def states(self, owner_id: str) -> Mapping[str, OccurrenceState]:
        rows = self._db.execute("SELECT * FROM occurrence_state WHERE owner_id = ?", (owner_id,))
        return {row["occurrence_id"]: OccurrenceState(
            row["occurrence_id"], row["version"], row["disposition"], row["title"], row["location"],
            datetime.fromisoformat(row["start_at"]) if row["start_at"] else None,
            datetime.fromisoformat(row["end_at"]) if row["end_at"] else None) for row in rows}

    def save(self, owner_id: str, event_id: str, state: OccurrenceState, expected_version: int,
             updated_at: datetime) -> None:
        if state.version != expected_version + 1:
            raise ValueError("new version must follow the expected version")
        start = _iso(state.start_at) if state.start_at else None
        end = _iso(state.end_at) if state.end_at else None
        if expected_version == 1:
            cursor = self._db.execute(
                """INSERT OR IGNORE INTO occurrence_state (occurrence_id, owner_id, event_id, version, disposition,
                   title, location, start_at, end_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (state.occurrence_id, owner_id, event_id, state.version, state.disposition, state.title,
                 state.location, start, end, _iso(updated_at)))
        else:
            cursor = self._db.execute(
                """UPDATE occurrence_state SET version = ?, disposition = ?, title = ?, location = ?, start_at = ?,
                   end_at = ?, updated_at = ? WHERE occurrence_id = ? AND owner_id = ? AND version = ?""",
                (state.version, state.disposition, state.title, state.location, start, end, _iso(updated_at),
                 state.occurrence_id, owner_id, expected_version))
        if cursor.rowcount != 1:
            raise VersionConflict("occurrence changed concurrently")


class SqliteReminderAckRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def acknowledged(self, owner_id: str) -> set[tuple[str, int]]:
        rows = self._db.execute(
            "SELECT occurrence_id, occurrence_version FROM reminder_ack WHERE owner_id = ?", (owner_id,))
        return {(row["occurrence_id"], row["occurrence_version"]) for row in rows}

    def add(self, owner_id: str, occurrence_id: str, occurrence_version: int, at: datetime) -> None:
        self._db.execute(
            """INSERT OR IGNORE INTO reminder_ack (owner_id, occurrence_id, occurrence_version, acknowledged_at)
               VALUES (?, ?, ?, ?)""", (owner_id, occurrence_id, occurrence_version, _iso(at)))


class SqliteIdempotencyStore:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def get(self, owner_id: str, operation: str, key: str) -> StoredResult | None:
        row = self._db.execute(
            "SELECT request_hash, result_json FROM idempotency WHERE owner_id = ? AND operation = ? AND key = ?",
            (owner_id, operation, key)).fetchone()
        return None if row is None else StoredResult(row["request_hash"], json.loads(row["result_json"]))

    def put(self, owner_id: str, operation: str, key: str, stored: StoredResult, at: datetime) -> None:
        self._db.execute(
            """INSERT INTO idempotency (owner_id, operation, key, request_hash, result_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (owner_id, operation, key, stored.request_hash, json.dumps(stored.result), _iso(at)))


class SqliteAuditLog:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def record(self, owner_id: str, operation: str, subject_id: str, at: datetime) -> None:
        self._db.execute("INSERT INTO audit_log (owner_id, operation, subject_id, occurred_at) VALUES (?, ?, ?, ?)",
                         (owner_id, operation, subject_id, _iso(at)))
