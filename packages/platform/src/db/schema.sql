-- AVP Platform schema (Step 3)
-- Idempotent: safe to re-run via migrate / server startup
-- Works with plain local Postgres (no Docker / no pgvector required for Studio demo).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Optional: enable when pgvector is installed (Docker image / Neon). Ignored on plain Windows Postgres.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not installed — continuing without vector extension (OK for local Studio demo)';
END $$;

-- Knowledge graph nodes
-- embedding is JSONB so plain Postgres works; pgvector-backed installs can still store arrays as JSON.
CREATE TABLE IF NOT EXISTS graph_nodes (
  id               SERIAL PRIMARY KEY,
  kind             TEXT NOT NULL,
  label            TEXT NOT NULL,
  description      TEXT,
  metadata         JSONB DEFAULT '{}',
  embedding        JSONB,
  written_by_agent TEXT,
  trace_id         TEXT,
  workspace_id     TEXT NOT NULL DEFAULT 'default',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS graph_nodes_workspace_kind_label_uidx
  ON graph_nodes (workspace_id, kind, label);
CREATE INDEX IF NOT EXISTS graph_nodes_kind_idx ON graph_nodes (kind);
CREATE INDEX IF NOT EXISTS graph_nodes_workspace_kind_idx ON graph_nodes (workspace_id, kind);

-- Knowledge graph edges
CREATE TABLE IF NOT EXISTS graph_edges (
  id           SERIAL PRIMARY KEY,
  from_node_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_node_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  weight       FLOAT NOT NULL DEFAULT 1.0,
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_node_id, to_node_id, kind)
);

CREATE INDEX IF NOT EXISTS graph_edges_from_idx ON graph_edges (from_node_id);
CREATE INDEX IF NOT EXISTS graph_edges_to_idx ON graph_edges (to_node_id);
CREATE INDEX IF NOT EXISTS graph_edges_kind_idx ON graph_edges (kind);

-- Agent registry
CREATE TABLE IF NOT EXISTS agent_registry (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  archetype     TEXT NOT NULL,
  domain        TEXT NOT NULL,
  runtime       TEXT NOT NULL,
  version       TEXT NOT NULL,
  manifest      JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  last_seen_at  TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  runtime      TEXT NOT NULL,
  operation    TEXT NOT NULL,
  node_id      INTEGER,
  edge_id      INTEGER,
  trace_id     TEXT NOT NULL,
  jwt_claims   JSONB,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_agent_ts_idx ON audit_log (agent_id, ts);
CREATE INDEX IF NOT EXISTS audit_log_trace_idx ON audit_log (trace_id);

-- Episodic memory
CREATE TABLE IF NOT EXISTS agent_episodes (
  id                    BIGSERIAL PRIMARY KEY,
  agent_id              TEXT NOT NULL,
  session_id            UUID NOT NULL,
  domain                TEXT NOT NULL,
  cycle_id              TEXT,
  feature_id            INTEGER REFERENCES graph_nodes(id),
  input_hash            TEXT NOT NULL,
  input_summary         TEXT,
  system_prompt_excerpt TEXT,
  output_summary        TEXT,
  output_node_ids       INTEGER[],
  outcome_node_id       INTEGER REFERENCES graph_nodes(id),
  confidence_pct        SMALLINT,
  latency_ms            INTEGER,
  llm_tokens_used       INTEGER,
  ts                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_episodes_agent_hash_idx ON agent_episodes (agent_id, input_hash);
CREATE INDEX IF NOT EXISTS agent_episodes_cycle_idx ON agent_episodes (cycle_id);

-- Value stream (cycle) state
CREATE TABLE IF NOT EXISTS cycles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL,
  workspace_id  TEXT NOT NULL DEFAULT 'default',
  status        TEXT NOT NULL DEFAULT 'active',
  current_stage TEXT NOT NULL DEFAULT 'SIGNALS',
  feature_id    INTEGER REFERENCES graph_nodes(id),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent calibration records
CREATE TABLE IF NOT EXISTS agent_calibration (
  id              BIGSERIAL PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  cycle_id        TEXT NOT NULL,
  predicted_value FLOAT,
  actual_value    FLOAT,
  error_pct       FLOAT,
  kpi             TEXT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_calibration_agent_ts_idx ON agent_calibration (agent_id, ts);

-- Studio users (humans — separate from agent identities)
CREATE TABLE IF NOT EXISTS studio_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','editor','viewer')),
  workspace_id  TEXT NOT NULL DEFAULT 'default',
  sso_provider  TEXT,
  password_hash TEXT,
  invited_by    UUID REFERENCES studio_users(id),
  last_active_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS studio_users_workspace_idx ON studio_users(workspace_id);

CREATE TABLE IF NOT EXISTS studio_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  workspace_id TEXT NOT NULL DEFAULT 'default',
  invited_by   UUID REFERENCES studio_users(id),
  token        TEXT UNIQUE NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio_settings (
  workspace_id            TEXT PRIMARY KEY DEFAULT 'default',
  notify_big_problems     BOOLEAN NOT NULL DEFAULT true,
  weekly_summary_email    BOOLEAN NOT NULL DEFAULT true,
  auto_group_feedback     BOOLEAN NOT NULL DEFAULT true,
  summary_language        TEXT NOT NULL DEFAULT 'en',
  retention_months        INTEGER NOT NULL DEFAULT 12,
  require_sso             BOOLEAN NOT NULL DEFAULT false,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO studio_settings (workspace_id) VALUES ('default') ON CONFLICT DO NOTHING;

-- Named approvers for portfolio gate decisions (distinct from Admin/Editor/Viewer)
CREATE TABLE IF NOT EXISTS studio_approvers (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  user_id      UUID NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS studio_sso_connections (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  provider     TEXT NOT NULL CHECK (provider IN ('google','microsoft','okta')),
  client_id    TEXT,
  client_secret_encrypted TEXT,
  connected_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS studio_connectors (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  connector    TEXT NOT NULL CHECK (connector IN ('zendesk','intercom','slack')),
  config_json  JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, connector)
);
