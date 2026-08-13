ALTER TABLE documents ADD COLUMN hackmd_note_id TEXT;
ALTER TABLE documents ADD COLUMN hackmd_synced_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS documents_hackmd_note_id_idx
  ON documents(hackmd_note_id);
