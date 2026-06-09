UPDATE users
SET is_admin = 1
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1);

UPDATE users
SET username = 'user_' || substr(replace(id, '-', ''), 1, 12)
WHERE username IS NULL;
