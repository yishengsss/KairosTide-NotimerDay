"""SQLite repositories for conversations, messages, turns and drafts.

They share the unit of work's connection, so a caller can span several of them in one transaction —
which is what `reserve` and `complete` need. They raise adapter-level signals (`PendingTurnError`)
that the application layer turns into its own errors; nothing here knows about HTTP.
"""

import json
import sqlite3
from datetime import datetime
from typing import Any

from kairos.application.errors import VersionConflict
from kairos.application.ports import PendingTurnError
from kairos.domain.conversation import Conversation, ConversationMessage, ConversationTurn
from kairos.domain.draft import Draft, DraftStatus, fields_from_json, target_from_json


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("refusing to store a naive datetime")
    return value.isoformat()


def _actions(raw: str | None) -> tuple[dict[str, Any], ...]:
    if not raw:
        return ()
    loaded: list[dict[str, Any]] = json.loads(raw)
    return tuple(loaded)


class SqliteConversationRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def create(self, conversation: Conversation) -> None:
        self._db.execute(
            "INSERT INTO conversation (conversation_id, owner_id, revision, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (conversation.conversation_id, conversation.owner_id, conversation.revision,
             _iso(conversation.created_at), _iso(conversation.updated_at)))

    def get(self, owner_id: str, conversation_id: str) -> Conversation | None:
        row = self._db.execute(
            "SELECT * FROM conversation WHERE owner_id = ? AND conversation_id = ?",
            (owner_id, conversation_id)).fetchone()
        if row is None:
            return None
        return Conversation(conversation_id=row["conversation_id"], owner_id=row["owner_id"],
                            revision=row["revision"], created_at=datetime.fromisoformat(row["created_at"]),
                            updated_at=datetime.fromisoformat(row["updated_at"]))

    def bump(self, conversation_id: str, expected_revision: int, at: datetime) -> None:
        cursor = self._db.execute(
            "UPDATE conversation SET revision = revision + 1, updated_at = ?"
            " WHERE conversation_id = ? AND revision = ?", (_iso(at), conversation_id, expected_revision))
        if cursor.rowcount != 1:
            raise VersionConflict("conversation changed since it was read")


class SqliteMessageRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def append(self, message: ConversationMessage) -> None:
        self._db.execute(
            "INSERT INTO conversation_message (message_id, owner_id, conversation_id, sequence, role, content,"
            " action_results_json, draft_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (message.message_id, message.owner_id, message.conversation_id, message.sequence, message.role,
             message.content,
             json.dumps(list(message.action_results), ensure_ascii=False) if message.action_results else None,
             message.draft_id, _iso(message.created_at)))

    def get(self, owner_id: str, message_id: str) -> ConversationMessage | None:
        row = self._db.execute(
            "SELECT * FROM conversation_message WHERE owner_id = ? AND message_id = ?",
            (owner_id, message_id)).fetchone()
        return self._row(row) if row else None

    def after(self, owner_id: str, conversation_id: str, sequence: int, limit: int) -> list[ConversationMessage]:
        rows = self._db.execute(
            "SELECT * FROM conversation_message WHERE owner_id = ? AND conversation_id = ? AND sequence > ?"
            " ORDER BY sequence LIMIT ?", (owner_id, conversation_id, sequence, limit)).fetchall()
        return [self._row(row) for row in rows]

    def tail(self, owner_id: str, conversation_id: str, limit: int) -> list[ConversationMessage]:
        """The newest `limit` messages, returned in conversation order."""
        rows = self._db.execute(
            "SELECT * FROM conversation_message WHERE owner_id = ? AND conversation_id = ?"
            " ORDER BY sequence DESC LIMIT ?", (owner_id, conversation_id, limit)).fetchall()
        return [self._row(row) for row in reversed(rows)]

    def latest(self, owner_id: str, conversation_id: str) -> ConversationMessage | None:
        row = self._db.execute(
            "SELECT * FROM conversation_message WHERE owner_id = ? AND conversation_id = ?"
            " ORDER BY sequence DESC LIMIT 1", (owner_id, conversation_id)).fetchone()
        return self._row(row) if row else None

    def draft_references(self, owner_id: str, conversation_id: str) -> list[str]:
        rows = self._db.execute(
            "SELECT draft_id FROM conversation_message WHERE owner_id = ? AND conversation_id = ?"
            " AND draft_id IS NOT NULL ORDER BY sequence DESC", (owner_id, conversation_id)).fetchall()
        seen: list[str] = []
        for row in rows:
            if row["draft_id"] not in seen:
                seen.append(row["draft_id"])
        return seen

    @staticmethod
    def _row(row: sqlite3.Row) -> ConversationMessage:
        return ConversationMessage(
            message_id=row["message_id"], owner_id=row["owner_id"], conversation_id=row["conversation_id"],
            sequence=row["sequence"], role=row["role"], content=row["content"],
            created_at=datetime.fromisoformat(row["created_at"]),
            action_results=_actions(row["action_results_json"]), draft_id=row["draft_id"])


class SqliteTurnRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def reserve(self, turn: ConversationTurn) -> None:
        pending = self._db.execute(
            "SELECT client_message_id FROM conversation_turn WHERE conversation_id = ? AND status = 'pending'",
            (turn.conversation_id,)).fetchone()
        if pending is not None:
            raise PendingTurnError("上一条消息还没有处理完，请稍后再发")
        self._db.execute(
            "INSERT INTO conversation_turn (owner_id, conversation_id, client_message_id, user_message_id,"
            " assistant_message_id, request_hash, content, timezone, expected_revision, status, response_json,"
            " created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'pending', NULL, ?)",
            (turn.owner_id, turn.conversation_id, turn.client_message_id, turn.user_message_id, turn.request_hash,
             turn.content, turn.timezone, turn.expected_revision, _iso(turn.created_at)))

    def pending_client_message_id(self, owner_id: str, conversation_id: str) -> str | None:
        row = self._db.execute(
            "SELECT client_message_id FROM conversation_turn WHERE owner_id = ? AND conversation_id = ?"
            " AND status = 'pending'", (owner_id, conversation_id)).fetchone()
        return None if row is None else str(row["client_message_id"])

    def complete(self, turn: ConversationTurn, assistant: ConversationMessage,
                 response: dict[str, Any]) -> None:
        cursor = self._db.execute(
            "UPDATE conversation_turn SET status = 'completed', assistant_message_id = ?, response_json = ?"
            " WHERE owner_id = ? AND conversation_id = ? AND client_message_id = ? AND status = 'pending'",
            (assistant.message_id, json.dumps(response, ensure_ascii=False), turn.owner_id,
             turn.conversation_id, turn.client_message_id))
        if cursor.rowcount != 1:
            raise PendingTurnError("turn is not pending")

    def find(self, owner_id: str, conversation_id: str, client_message_id: str) -> ConversationTurn | None:
        row = self._db.execute(
            "SELECT * FROM conversation_turn WHERE owner_id = ? AND conversation_id = ?"
            " AND client_message_id = ?", (owner_id, conversation_id, client_message_id)).fetchone()
        if row is None:
            return None
        return ConversationTurn(
            owner_id=row["owner_id"], conversation_id=row["conversation_id"],
            client_message_id=row["client_message_id"], user_message_id=row["user_message_id"],
            request_hash=row["request_hash"], content=row["content"], timezone=row["timezone"],
            expected_revision=row["expected_revision"], status=row["status"],
            created_at=datetime.fromisoformat(row["created_at"]),
            assistant_message_id=row["assistant_message_id"],
            response=json.loads(row["response_json"]) if row["response_json"] else None)


class SqliteDraftRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def add(self, draft: Draft) -> None:
        self._db.execute(
            "INSERT INTO draft (draft_id, owner_id, conversation_id, source_message_id, status, digest,"
            " anchor_at, expires_at, basis_phrase, fields_json, superseded_by, committed_event_id, created_at,"
            " updated_at, kind, target_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (draft.draft_id, draft.owner_id, draft.conversation_id, draft.source_message_id, draft.status,
             draft.digest, _iso(draft.anchor_at), _iso(draft.expires_at), draft.basis_phrase,
             draft.fields_json(), draft.superseded_by, draft.committed_event_id, _iso(draft.created_at),
             _iso(draft.updated_at), draft.kind,
             json.dumps(draft.target.to_json(), ensure_ascii=False) if draft.target else None))

    def get(self, owner_id: str, draft_id: str) -> Draft | None:
        row = self._db.execute("SELECT * FROM draft WHERE owner_id = ? AND draft_id = ?",
                               (owner_id, draft_id)).fetchone()
        return self._row(row) if row else None

    def find_for_source(self, owner_id: str, conversation_id: str, source_message_id: str,
                        statuses: tuple[str, ...]) -> Draft | None:
        marks = ", ".join("?" for _ in statuses)
        row = self._db.execute(
            f"SELECT * FROM draft WHERE owner_id = ? AND conversation_id = ? AND source_message_id = ?"
            f" AND status IN ({marks}) ORDER BY rowid DESC LIMIT 1",
            (owner_id, conversation_id, source_message_id, *statuses)).fetchone()
        return self._row(row) if row else None

    def live(self, owner_id: str, conversation_id: str) -> Draft | None:
        row = self._db.execute(
            "SELECT * FROM draft WHERE owner_id = ? AND conversation_id = ?"
            " AND status IN ('ready', 'needs_clarification') ORDER BY rowid DESC LIMIT 1",
            (owner_id, conversation_id)).fetchone()
        return self._row(row) if row else None

    def newest(self, owner_id: str, conversation_id: str) -> Draft | None:
        row = self._db.execute(
            "SELECT * FROM draft WHERE owner_id = ? AND conversation_id = ? ORDER BY rowid DESC LIMIT 1",
            (owner_id, conversation_id)).fetchone()
        return self._row(row) if row else None

    def supersede(self, owner_id: str, draft_id: str, successor_id: str, at: datetime) -> None:
        self._db.execute(
            "UPDATE draft SET status = 'superseded', superseded_by = ?, updated_at = ?"
            " WHERE owner_id = ? AND draft_id = ? AND status IN ('ready', 'needs_clarification')",
            (successor_id, _iso(at), owner_id, draft_id))

    def commit_draft(self, owner_id: str, draft_id: str, digest: str, event_id: str, at: datetime) -> None:
        cursor = self._db.execute(
            "UPDATE draft SET status = 'committed', committed_event_id = ?, updated_at = ?"
            " WHERE owner_id = ? AND draft_id = ? AND status = 'ready' AND digest = ?",
            (event_id, _iso(at), owner_id, draft_id, digest))
        if cursor.rowcount != 1:
            raise VersionConflict("draft is no longer confirmable")

    def discard(self, owner_id: str, draft_id: str, at: datetime) -> None:
        cursor = self._db.execute(
            "UPDATE draft SET status = 'discarded', updated_at = ?"
            " WHERE owner_id = ? AND draft_id = ? AND status IN ('ready', 'needs_clarification')",
            (_iso(at), owner_id, draft_id))
        if cursor.rowcount != 1:
            raise VersionConflict("draft is no longer open")

    @staticmethod
    def _row(row: sqlite3.Row) -> Draft:
        status: DraftStatus = row["status"]
        return Draft(
            draft_id=row["draft_id"], owner_id=row["owner_id"], conversation_id=row["conversation_id"],
            source_message_id=row["source_message_id"], status=status, digest=row["digest"],
            anchor_at=datetime.fromisoformat(row["anchor_at"]),
            expires_at=datetime.fromisoformat(row["expires_at"]), basis_phrase=row["basis_phrase"],
            fields=fields_from_json(json.loads(row["fields_json"])),
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]), superseded_by=row["superseded_by"],
            committed_event_id=row["committed_event_id"], kind=row["kind"],
            target=target_from_json(json.loads(row["target_json"])) if row["target_json"] else None)


__all__ = [
    "SqliteConversationRepository", "SqliteDraftRepository",
    "SqliteMessageRepository", "SqliteTurnRepository",
]
