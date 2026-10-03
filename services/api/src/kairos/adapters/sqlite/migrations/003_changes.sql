-- M2.5: one-off changes and deletions of single instances, and drafts that change saved events.
-- SQLite cannot alter a CHECK constraint, so occurrence_state is rebuilt with the new disposition.
CREATE TABLE occurrence_state_new (
  occurrence_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES event_series(event_id),
  version INTEGER NOT NULL CHECK (version >= 2),
  disposition TEXT NOT NULL CHECK (disposition IN ('scheduled', 'excused', 'missed', 'cancelled')),
  title TEXT,
  location TEXT,
  start_at TEXT,
  end_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK ((start_at IS NULL) = (end_at IS NULL)),
  CHECK (start_at IS NULL OR end_at > start_at)
);
INSERT INTO occurrence_state_new (occurrence_id, owner_id, event_id, version, disposition, updated_at)
  SELECT occurrence_id, owner_id, event_id, version, disposition, updated_at FROM occurrence_state;
DROP TABLE occurrence_state;
ALTER TABLE occurrence_state_new RENAME TO occurrence_state;
CREATE INDEX idx_occurrence_state_owner ON occurrence_state(owner_id);

ALTER TABLE draft ADD COLUMN kind TEXT NOT NULL DEFAULT 'create'
  CHECK (kind IN ('create', 'change', 'cancel', 'excuse'));
ALTER TABLE draft ADD COLUMN target_json TEXT
