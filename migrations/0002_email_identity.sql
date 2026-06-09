ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  return_to TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at ON email_verification_codes(expires_at);
