-- M4: an image import is one batch draft with several items. SQLite cannot alter a CHECK constraint,
-- so draft is rebuilt with the batch kind and an items column (NULL for every other kind).
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
    ('create', 'change', 'cancel', 'excuse', 'task_create', 'task_change', 'task_cancel', 'batch')),
  target_json TEXT,
  items_json TEXT,
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
CREATE INDEX idx_draft_conversation ON draft(conversation_id, status);
