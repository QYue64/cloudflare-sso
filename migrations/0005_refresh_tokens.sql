CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  replaced_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_client ON refresh_tokens(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
