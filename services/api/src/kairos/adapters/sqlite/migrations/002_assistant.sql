-- Note: migrate() splits on semicolons, so comments in this file must not contain one.
-- Assistant conversation, its turns, and the drafts the user has not confirmed yet.
-- Drafts are deliberately separate from event_series: an unconfirmed draft must never reach /state,
-- reminders or the schedule. Only a confirmed commit writes an event.

CREATE TABLE conversation (
  conversation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, conversation_id)
);
CREATE INDEX idx_conversation_owner ON conversation(owner_id, updated_at);

-- The full text history. The model only ever sees a trimmed tail of this: the server keeps all of it.
CREATE TABLE conversation_message (
  message_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversation(conversation_id),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  action_results_json TEXT,
  draft_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, sequence)
);

-- One row per send attempt, so a retry after a crash resumes the same turn instead of re-talking to
-- the model. `pending` is the incomplete-turn marker: the partial index enforces "at most one".
CREATE TABLE conversation_turn (
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversation(conversation_id),
  client_message_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL REFERENCES conversation_message(message_id),
  assistant_message_id TEXT REFERENCES conversation_message(message_id),
  request_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  timezone TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, conversation_id, client_message_id)
);
CREATE UNIQUE INDEX idx_conversation_turn_pending ON conversation_turn(conversation_id) WHERE status = 'pending';

-- Draft content is immutable. Changing one's mind produces a new draft and supersedes the old row, so
-- the only mutable column is `status`: commit is guarded by `WHERE status = 'ready'` and by the digest
-- of the exact content the user was shown.
CREATE TABLE draft (
  draft_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversation(conversation_id),
  source_message_id TEXT NOT NULL REFERENCES conversation_message(message_id),
  status TEXT NOT NULL CHECK (
    status IN ('needs_clarification', 'ready', 'committed', 'superseded', 'discarded')),
  digest TEXT NOT NULL,
  anchor_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  basis_phrase TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  superseded_by TEXT,
  committed_event_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, draft_id)
);
CREATE INDEX idx_draft_conversation ON draft(conversation_id, status);
