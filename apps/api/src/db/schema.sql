CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  allowed_domains JSONB NOT NULL,
  privacy_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  anonymous_user_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  device TEXT,
  browser TEXT,
  os TEXT,
  viewport JSONB,
  country_or_region TEXT,
  referrer TEXT
);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  url_path TEXT NOT NULL,
  url_query_redacted TEXT,
  title_masked TEXT,
  element_selector_hash TEXT,
  element_role TEXT,
  element_text_masked_or_limited TEXT,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  viewport_x INTEGER,
  viewport_y INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE issues (
  issue_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  issue_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  affected_sessions_count INTEGER NOT NULL,
  affected_users_count INTEGER NOT NULL,
  severity_score INTEGER NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  trend TEXT NOT NULL,
  related_url_path TEXT,
  related_feature_id TEXT,
  example_session_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL
);

CREATE TABLE admin_users (
  admin_user_id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL,
  name TEXT,
  picture_url TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE project_memberships (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  admin_user_id TEXT NOT NULL REFERENCES admin_users(admin_user_id),
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, admin_user_id)
);

CREATE TABLE admin_sessions (
  session_id_hash TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(admin_user_id),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent_hash TEXT,
  ip_hash TEXT
);

CREATE TABLE audit_logs (
  audit_log_id TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES admin_users(admin_user_id),
  action TEXT NOT NULL,
  project_id TEXT REFERENCES projects(project_id),
  created_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
