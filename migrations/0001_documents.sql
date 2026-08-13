CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  owner_email TEXT,
  share_token_hash TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS documents_updated_at_idx
  ON documents(updated_at DESC);

CREATE INDEX IF NOT EXISTS documents_share_token_hash_idx
  ON documents(share_token_hash);
