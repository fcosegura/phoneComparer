CREATE TABLE IF NOT EXISTS device_cache (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL DEFAULT 'public',
  normalized_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  search_query TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(scope_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_device_cache_scope_name
  ON device_cache(scope_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_device_cache_last_used
  ON device_cache(last_used_at DESC);

CREATE TABLE IF NOT EXISTS comparison_history (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL DEFAULT 'public',
  comparison_key TEXT NOT NULL,
  device_names_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comparison_history_scope_key
  ON comparison_history(scope_id, comparison_key);
