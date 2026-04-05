create table if not exists auth_users (
  id TEXT primary key,
  email TEXT not null,
  password_hash TEXT not null,
  created_at TEXT not null,
  updated_at TEXT not null
);

create unique index if not exists idx_auth_users_email on auth_users (email);

create table if not exists auth_sessions (
  id TEXT primary key,
  user_id TEXT not null,
  token_hash TEXT not null,
  created_at TEXT not null,
  expires_at TEXT not null
);

create unique index if not exists idx_auth_sessions_token on auth_sessions (token_hash);
create index if not exists idx_auth_sessions_user on auth_sessions (user_id);

PRAGMA optimize;
