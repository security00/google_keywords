-- Signal Discovery: signal_candidates 表
-- 存储从社区/媒体源发现的关键词候选

CREATE TABLE IF NOT EXISTS signal_candidates (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL UNIQUE,
    keyword_normalized TEXT NOT NULL,
    signal_sources TEXT NOT NULL DEFAULT '{}',       -- JSON: 哪些源发现
    signal_score REAL NOT NULL DEFAULT 0,           -- 多源加权分
    avg_hotness REAL NOT NULL DEFAULT 0,            -- 源自带平均热度
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    dataforseo_volume INTEGER DEFAULT 0,
    dataforseo_kd REAL DEFAULT 0,
    dataforseo_cpc REAL DEFAULT 0,
    processed INTEGER DEFAULT 0,                    -- 是否已送预计算管线
    accepted TEXT DEFAULT NULL,                      -- accepted / rejected / pending
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signal_candidates_score ON signal_candidates(signal_score DESC);
CREATE INDEX IF NOT EXISTS idx_signal_candidates_processed ON signal_candidates(processed);
CREATE INDEX IF NOT EXISTS idx_signal_candidates_keyword_norm ON signal_candidates(keyword_normalized);
