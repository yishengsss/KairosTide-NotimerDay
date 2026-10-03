"""SQLite storage for flexible tasks.

The normalized title is stored alongside the real one so a lookup by what the user typed is an
index hit rather than a scan over every task. Writes are row-count guarded on the version the
caller was shown, like every other repository here.
"""

import sqlite3
from datetime import datetime

from kairos.application.errors import VersionConflict
from kairos.domain.tasks import FlexibleTask, normalized_title


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("refusing to store a naive datetime")
    return value.isoformat()


class SqliteFlexibleTaskRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def list_tasks(self, owner_id: str) -> list[FlexibleTask]:
        rows = self._db.execute(
            "SELECT * FROM flexible_task WHERE owner_id = ? AND deleted = 0"
            " ORDER BY created_at DESC, task_id DESC", (owner_id,)).fetchall()
        return [self._row(row) for row in rows]

    def get_task(self, owner_id: str, task_id: str) -> FlexibleTask | None:
        row = self._db.execute(
            "SELECT * FROM flexible_task WHERE owner_id = ? AND task_id = ? AND deleted = 0",
            (owner_id, task_id)).fetchone()
        return self._row(row) if row else None

    def find_by_title(self, owner_id: str, normalized: str) -> list[FlexibleTask]:
        rows = self._db.execute(
            "SELECT * FROM flexible_task WHERE owner_id = ? AND normalized_title = ? AND deleted = 0"
            " ORDER BY created_at DESC, task_id DESC", (owner_id, normalized)).fetchall()
        return [self._row(row) for row in rows]

    def add_task(self, task: FlexibleTask, created_at: datetime) -> None:
        self._db.execute(
            "INSERT INTO flexible_task (task_id, owner_id, version, title, normalized_title, timezone,"
            " lifecycle, deadline, precision, source_message_id, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (task.task_id, task.owner_id, task.version, task.title, normalized_title(task.title),
             task.timezone, task.lifecycle, _iso(task.deadline) if task.deadline else None,
             task.precision, task.source_message_id, _iso(created_at), _iso(created_at)))

    def update_task(self, task: FlexibleTask, expected_version: int, updated_at: datetime) -> None:
        if task.version != expected_version + 1:
            raise ValueError("new version must follow the expected version")
        cursor = self._db.execute(
            "UPDATE flexible_task SET version = ?, title = ?, normalized_title = ?, lifecycle = ?,"
            " deadline = ?, precision = ?, updated_at = ?"
            " WHERE owner_id = ? AND task_id = ? AND version = ? AND deleted = 0",
            (task.version, task.title, normalized_title(task.title), task.lifecycle,
             _iso(task.deadline) if task.deadline else None, task.precision, _iso(updated_at),
             task.owner_id, task.task_id, expected_version))
        if cursor.rowcount != 1:
            raise VersionConflict("task changed concurrently")

    def delete_task(self, owner_id: str, task_id: str, expected_version: int, at: datetime) -> None:
        cursor = self._db.execute(
            "UPDATE flexible_task SET deleted = 1, version = version + 1, updated_at = ?"
            " WHERE owner_id = ? AND task_id = ? AND version = ? AND deleted = 0",
            (_iso(at), owner_id, task_id, expected_version))
        if cursor.rowcount != 1:
            raise VersionConflict("task changed concurrently")

    @staticmethod
    def _row(row: sqlite3.Row) -> FlexibleTask:
        deadline = row["deadline"]
        return FlexibleTask(
            task_id=row["task_id"], owner_id=row["owner_id"], version=row["version"], title=row["title"],
            timezone=row["timezone"], lifecycle=row["lifecycle"],
            deadline=datetime.fromisoformat(deadline) if deadline else None,
            precision=row["precision"], source_message_id=row["source_message_id"])


__all__ = ["SqliteFlexibleTaskRepository"]
