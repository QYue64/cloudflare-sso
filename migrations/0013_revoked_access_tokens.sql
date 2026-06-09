CREATE TABLE IF NOT EXISTS revoked_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_expires_at ON revoked_access_tokens(expires_at);
