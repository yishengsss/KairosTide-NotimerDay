-- M3: flexible tasks. No fixed start time, an optional deadline, and a lifecycle the user drives.
CREATE TABLE flexible_task (
  task_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  normalized_title TEXT NOT NULL,
  timezone TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('planned', 'active', 'done')),
  deadline TEXT,
  precision TEXT CHECK (precision IN ('date', 'instant')),
  source_message_id TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((deadline IS NULL) = (precision IS NULL))
);
CREATE INDEX idx_flexible_task_owner ON flexible_task(owner_id, deleted, lifecycle);
CREATE INDEX idx_flexible_task_title ON flexible_task(owner_id, normalized_title);

-- SQLite cannot alter a CHECK constraint, so draft is rebuilt with the three task kinds added.
CREATE TABLE draft_new (
  draft_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversation(conversation_id),
  source_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('needs_clarification', 'ready', 'committed', 'superseded', 'discarded')),
  digest TEXT NOT NULL,
  anchor_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  basis_phrase TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  superseded_by TEXT,
  committed_event_id TEXT,
  kind TEXT NOT NULL DEFAULT 'create' CHECK (kind IN
    ('create', 'change', 'cancel', 'excuse', 'task_create', 'task_change', 'task_cancel')),
  target_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO draft_new (draft_id, owner_id, conversation_id, source_message_id, status, digest,
                       anchor_at, expires_at, basis_phrase, fields_json, superseded_by,
                       committed_event_id, kind, target_json, created_at, updated_at)
  SELECT draft_id, owner_id, conversation_id, source_message_id, status, digest,
         anchor_at, expires_at, basis_phrase, fields_json, superseded_by,
         committed_event_id, kind, target_json, created_at, updated_at FROM draft;
DROP TABLE draft;
ALTER TABLE draft_new RENAME TO draft;
CREATE INDEX idx_draft_conversation ON draft(conversation_id, status)
