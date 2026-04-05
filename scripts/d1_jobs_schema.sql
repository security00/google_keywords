create table if not exists research_jobs (
  id TEXT primary key,
  user_id TEXT not null,
  job_type TEXT not null,
  status TEXT not null,
  task_ids TEXT,
  payload TEXT,
  session_id TEXT,
  error TEXT,
  created_at TEXT not null,
  updated_at TEXT not null
);

create index if not exists idx_jobs_user_created on research_jobs (user_id, created_at desc);
create index if not exists idx_jobs_status on research_jobs (status, created_at desc);

PRAGMA optimize;
