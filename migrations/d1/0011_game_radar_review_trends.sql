-- Add operator review and trend validation fields for Game Radar candidates.
-- Radar candidates stay admin-only; promotion to game_keyword_pipeline remains a later explicit step.

ALTER TABLE game_radar_candidates ADD COLUMN operator_note TEXT;
ALTER TABLE game_radar_candidates ADD COLUMN trend_ratio REAL;
ALTER TABLE game_radar_candidates ADD COLUMN trend_slope REAL;
ALTER TABLE game_radar_candidates ADD COLUMN trend_verdict TEXT;
ALTER TABLE game_radar_candidates ADD COLUMN trend_checked_at TEXT;
ALTER TABLE game_radar_candidates ADD COLUMN trend_reason TEXT;
ALTER TABLE game_radar_candidates ADD COLUMN trend_series TEXT;
ALTER TABLE game_radar_candidates ADD COLUMN serp_organic INTEGER;
ALTER TABLE game_radar_candidates ADD COLUMN serp_auth INTEGER;
ALTER TABLE game_radar_candidates ADD COLUMN serp_featured INTEGER;
ALTER TABLE game_radar_candidates ADD COLUMN serp_game_relevance INTEGER;
ALTER TABLE game_radar_candidates ADD COLUMN serp_checked_at TEXT;
ALTER TABLE game_radar_candidates ADD COLUMN serp_reason TEXT;
