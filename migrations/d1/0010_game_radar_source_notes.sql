-- Add operator-facing notes for why a curated game radar source is enabled,
-- disabled, or only used through another scanner path.

ALTER TABLE game_radar_sources ADD COLUMN status_note TEXT;

UPDATE game_radar_sources
SET status_note = 'Primary radar source: game-page sitemap has lastmod and clean /en/g/ game URLs.'
WHERE id = 'poki';

UPDATE game_radar_sources
SET status_note = 'Disabled for sitemap radar: sitemap has no lastmod and surfaces many old games; keep CrazyGames in the existing /new scanner instead.'
WHERE id = 'crazygames';

UPDATE game_radar_sources
SET status_note = 'Disabled pending calibration: sitemap contains real game pages but mostly historical category paths; needs freshness signal or stricter source rules before enabling.'
WHERE id = 'addictinggames';
