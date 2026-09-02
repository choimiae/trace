// SQLite 스키마. tsc가 .sql 파일을 dist로 복사하지 않으므로 문자열 상수로 둔다.
// REFERENCES 절을 넣지 않는다. MemoryStore가 참조 무결성을 검사하지 않으므로
// 두 구현체의 동작을 같게 유지하려면 SQLite도 강제하지 않아야 한다.
export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  allowed_domains TEXT NOT NULL,
  privacy_config TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  type TEXT NOT NULL,
  url_path TEXT NOT NULL,
  url_query_redacted TEXT,
  title_masked TEXT,
  element_selector_hash TEXT,
  element_role TEXT,
  element_text_masked_or_limited TEXT,
  x REAL,
  y REAL,
  viewport_x INTEGER,
  viewport_y INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  screen_context TEXT,
  error_name TEXT,
  error_source TEXT,
  error_line INTEGER
);

CREATE INDEX IF NOT EXISTS events_project_timestamp ON events (project_id, timestamp);
CREATE INDEX IF NOT EXISTS events_project_session ON events (project_id, session_id);
CREATE INDEX IF NOT EXISTS events_project_session_timestamp ON events (project_id, session_id, timestamp);

CREATE TABLE IF NOT EXISTS issues (
  issue_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  affected_sessions_count INTEGER NOT NULL,
  affected_users_count INTEGER NOT NULL,
  severity_score INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  trend TEXT NOT NULL,
  related_url_path TEXT,
  related_feature_id TEXT,
  example_session_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  related_error_signature TEXT
);

CREATE INDEX IF NOT EXISTS issues_project_severity ON issues (project_id, severity_score DESC);

CREATE TABLE IF NOT EXISTS admin_users (
  admin_user_id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL,
  name TEXT,
  picture_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_memberships (
  project_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, admin_user_id)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id_hash TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent_hash TEXT,
  ip_hash TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_log_id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  action TEXT NOT NULL,
  project_id TEXT,
  created_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS audit_logs_project_created ON audit_logs (project_id, created_at DESC, audit_log_id DESC);
`;
