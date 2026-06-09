ALTER TABLE sessions ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id);
