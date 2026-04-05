create extension if not exists "pgcrypto";

create table if not exists research_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  keywords text[] not null,
  date_from date,
  date_to date,
  benchmark text,
  include_top boolean default false,
  use_filter boolean default true,
  filter_terms text[],
  filter_prompt text,
  filter_summary jsonb,
  created_at timestamptz default now()
);

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references research_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  value integer,
  type text,
  source text,
  filtered boolean default false,
  created_at timestamptz default now()
);

create table if not exists comparisons (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references research_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  benchmark text,
  date_from date,
  date_to date,
  summary jsonb,
  recent_points integer,
  metrics_version text,
  created_at timestamptz default now()
);

create table if not exists comparison_results (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references comparisons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  avg_value numeric,
  benchmark_value numeric,
  ratio numeric,
  ratio_mean numeric,
  ratio_recent numeric,
  ratio_coverage numeric,
  ratio_peak numeric,
  slope_diff numeric,
  volatility numeric,
  crossings integer,
  verdict text,
  trend_series jsonb,
  explanation jsonb,
  intent jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_sessions_user_created on research_sessions (user_id, created_at desc);
create index if not exists idx_candidates_session on candidates (session_id);
create index if not exists idx_comparisons_session on comparisons (session_id);
create index if not exists idx_results_comparison on comparison_results (comparison_id);

alter table research_sessions enable row level security;
alter table candidates enable row level security;
alter table comparisons enable row level security;
alter table comparison_results enable row level security;

create policy "sessions owner" on research_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "candidates owner" on candidates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "comparisons owner" on comparisons
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "comparison results owner" on comparison_results
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
