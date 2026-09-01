CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agent_accesses (login TEXT PRIMARY KEY, password_hash TEXT NOT NULL, research_id INTEGER NOT NULL, agent_id TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_agent_accesses_research_agent ON agent_accesses(research_id, agent_id);
