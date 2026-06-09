CREATE TABLE IF NOT EXISTS oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  last_redirect_uri TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_grants_user_client_active
  ON oauth_grants(user_id, client_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_grants_user_id ON oauth_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_client_id ON oauth_grants(client_id);
