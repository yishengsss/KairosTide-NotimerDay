"""A transaction per use case. Writers take the lock up front (BEGIN IMMEDIATE); readers never write."""

from pathlib import Path
from types import TracebackType
from typing import Self

from .assistant_repositories import (
    SqliteConversationRepository,
    SqliteDraftRepository,
    SqliteMessageRepository,
    SqliteTurnRepository,
)
from .database import connect
from .repositories import (
    SqliteAuditLog,
    SqliteEventRepository,
    SqliteIdempotencyStore,
    SqliteOccurrenceStateRepository,
    SqliteReminderAckRepository,
)
from .task_repository import SqliteFlexibleTaskRepository


class SqliteUnitOfWork:
    events: SqliteEventRepository
    occurrences: SqliteOccurrenceStateRepository
    tasks: SqliteFlexibleTaskRepository
    acks: SqliteReminderAckRepository
    idempotency: SqliteIdempotencyStore
    audit: SqliteAuditLog
    conversations: SqliteConversationRepository
    messages: SqliteMessageRepository
    turns: SqliteTurnRepository
    drafts: SqliteDraftRepository

    def __init__(self, path: str | Path, *, write: bool) -> None:
        self._path = path
        self._write = write

    def __enter__(self) -> Self:
        self._db = connect(self._path)
        if self._write:
            self._db.execute("BEGIN IMMEDIATE")
        else:
            self._db.execute("PRAGMA query_only = ON")
            self._db.execute("BEGIN")
        self.events = SqliteEventRepository(self._db)
        self.occurrences = SqliteOccurrenceStateRepository(self._db)
        self.tasks = SqliteFlexibleTaskRepository(self._db)
        self.acks = SqliteReminderAckRepository(self._db)
        self.idempotency = SqliteIdempotencyStore(self._db)
        self.audit = SqliteAuditLog(self._db)
        self.conversations = SqliteConversationRepository(self._db)
        self.messages = SqliteMessageRepository(self._db)
        self.turns = SqliteTurnRepository(self._db)
        self.drafts = SqliteDraftRepository(self._db)
        return self

    def commit(self) -> None:
        if not self._write:
            raise RuntimeError("read-only unit of work cannot commit")
        self._db.execute("COMMIT")

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None,
                 tb: TracebackType | None) -> None:
        try:
            if self._db.in_transaction:
                self._db.execute("ROLLBACK")
        finally:
            self._db.close()


class SqliteUnitOfWorkFactory:
    def __init__(self, path: str | Path) -> None:
        self.path = path

    def __call__(self, *, write: bool) -> SqliteUnitOfWork:
        return SqliteUnitOfWork(self.path, write=write)
