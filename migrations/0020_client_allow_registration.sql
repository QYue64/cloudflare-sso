-- 为客户端添加注册开关字段
ALTER TABLE clients ADD COLUMN allow_registration INTEGER NOT NULL DEFAULT 1;
