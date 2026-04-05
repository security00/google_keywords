create index if not exists idx_sessions_user_created on research_sessions (user_id, created_at desc);
create index if not exists idx_candidates_session on candidates (session_id);
create index if not exists idx_comparisons_session on comparisons (session_id);
create index if not exists idx_results_comparison on comparison_results (comparison_id);
PRAGMA optimize;
