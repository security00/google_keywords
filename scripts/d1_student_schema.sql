-- ============================================
-- 学员系统 D1 schema 扩展
-- ============================================

-- 1. auth_users 增加 trial 和 role 字段
-- D1 不支持 ALTER TABLE ADD COLUMN 很好，用新 schema 重建
-- 实际操作：新建 auth_users_v2 表 → 数据迁移 → 删旧表 → 改名

-- 新版 auth_users
create table if not exists auth_users_v2 (
  id TEXT primary key,
  email TEXT not null,
  password_hash TEXT not null,
  role TEXT not null default 'student',  -- 'admin' | 'student'
  trial_started_at TEXT,                  -- 注册时间（即为 trial 开始时间）
  trial_expires_at TEXT,                  -- trial 到期时间
  created_at TEXT not null,
  updated_at TEXT not null
);

create unique index if not exists idx_auth_users_v2_email on auth_users_v2 (email);

-- 2. 邀请码表
create table if not exists invite_codes (
  code TEXT primary key,
  created_by TEXT not null,               -- 创建者 user_id
  used_by TEXT,                            -- 使用者 user_id（null=未使用）
  max_uses INTEGER not null default 1,    -- 最大使用次数
  current_uses INTEGER not null default 0,
  expires_at TEXT,                         -- 邀请码过期时间
  created_at TEXT not null default (datetime('now'))
);

create index if not exists idx_invite_codes_created_by on invite_codes (created_by);

-- 3. 每日 API 用量表
create table if not exists daily_api_usage (
  user_id TEXT not null,
  date TEXT not null,                      -- YYYY-MM-DD
  api_calls INTEGER not null default 0,
  primary key (user_id, date)
);

-- 4. 迁移数据从 auth_users → auth_users_v2
-- （手动执行，见下方迁移脚本）

-- PRAGMA optimize;
