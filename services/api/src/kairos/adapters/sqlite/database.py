"""SQLite connection handling and forward-only migrations."""

import sqlite3
from importlib import resources
from pathlib import Path


def connect(path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path), timeout=10, isolation_level=None, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    if str(path) != ":memory:":
        connection.execute("PRAGMA journal_mode = WAL")
    return connection


def migrate(path: str | Path) -> list[str]:
    """Apply pending migrations in name order, each in its own transaction. Returns applied names."""
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    connection = connect(path)
    try:
        connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)")
        done = {row["name"] for row in connection.execute("SELECT name FROM schema_migrations")}
        folder = resources.files("kairos.adapters.sqlite") / "migrations"
        applied: list[str] = []
        for entry in sorted(folder.iterdir(), key=lambda item: item.name):
            if not entry.name.endswith(".sql") or entry.name in done:
                continue
            connection.execute("BEGIN IMMEDIATE")
            try:
                for statement in entry.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        connection.execute(statement)
                connection.execute("INSERT INTO schema_migrations (name) VALUES (?)", (entry.name,))
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            applied.append(entry.name)
        return applied
    finally:
        connection.close()
