CREATE TABLE IF NOT EXISTS user_client_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  username TEXT,
  email TEXT,
  display_name TEXT,
  nickname TEXT,
  avatar_url TEXT,
  email_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, client_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_client_profiles_user ON user_client_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_client_profiles_client ON user_client_profiles(client_id);
