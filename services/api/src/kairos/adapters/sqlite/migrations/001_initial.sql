-- Series define timing. Occurrence rows exist only once the user records a fact about an instance.
CREATE TABLE event_series (
  event_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  location TEXT,
  timezone TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  recurrence_json TEXT,
  created_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  CHECK (end_at > start_at)
);
CREATE INDEX idx_event_series_owner ON event_series(owner_id, deleted);

CREATE TABLE occurrence_state (
  occurrence_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES event_series(event_id),
  version INTEGER NOT NULL CHECK (version >= 2),
  disposition TEXT NOT NULL CHECK (disposition IN ('scheduled', 'excused', 'missed')),
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_occurrence_state_owner ON occurrence_state(owner_id);

CREATE TABLE reminder_ack (
  owner_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  occurrence_version INTEGER NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, occurrence_id, occurrence_version)
);

CREATE TABLE idempotency (
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, operation, key)
);

CREATE TABLE audit_log (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
