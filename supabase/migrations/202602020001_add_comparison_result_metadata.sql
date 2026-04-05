alter table public.comparison_results
  add column if not exists trend_series jsonb,
  add column if not exists explanation jsonb,
  add column if not exists intent jsonb;
