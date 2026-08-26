import type { DashboardSummary, EventBatch, Issue, TraceEvent } from "@trace/shared";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { SQLITE_SCHEMA } from "../db/schema.sqlite.js";
import { buildDashboardSummary } from "./dashboard-summary.js";
import type {
  AddProjectMembershipInput,
  AdminRole,
  AdminSessionRecord,
  AdminUserRecord,
  AuditLogRecord,
  CreateAdminSessionInput,
  CreateAuditLogInput,
  CreateProjectInput,
  ProjectMembershipRecord,
  ProjectRecord,
  TraceStore,
  UpsertAdminUserFromGoogleInput,
} from "./types.js";

type Row = Record<string, unknown>;

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as T;
}

export class SqliteStore implements TraceStore {
  readonly isDurable = true;
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    if (filePath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.exec(SQLITE_SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project: ProjectRecord = {
      projectId: `proj_${nanoid(10)}`,
      name: input.name,
      allowedDomains: input.allowedDomains,
      privacyConfig: { strictMasking: true, queryRedaction: true, inputCapture: false },
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO projects (project_id, name, allowed_domains, privacy_config, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        project.projectId,
        project.name,
        JSON.stringify(project.allowedDomains),
        JSON.stringify(project.privacyConfig),
        project.createdAt,
      );

    return project;
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM projects WHERE project_id = ?`).get(projectId) as Row | undefined;
    if (!row) return undefined;

    return {
      projectId: row.project_id as string,
      name: row.name as string,
      allowedDomains: JSON.parse(row.allowed_domains as string) as string[],
      privacyConfig: JSON.parse(row.privacy_config as string) as ProjectRecord["privacyConfig"],
      createdAt: row.created_at as string,
    };
  }

  async upsertAdminUserFromGoogle(input: UpsertAdminUserFromGoogleInput): Promise<AdminUserRecord> {
    const email = input.email.toLowerCase();
    const byEmail = this.db.prepare(`SELECT google_sub FROM admin_users WHERE email = ?`).get(email) as
      | Row
      | undefined;
    if (byEmail && byEmail.google_sub !== input.googleSub) throw new Error("admin_email_conflict");

    const existing = this.db.prepare(`SELECT * FROM admin_users WHERE google_sub = ?`).get(input.googleSub) as
      | Row
      | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE admin_users
              SET email = ?, email_verified = ?, name = COALESCE(?, name),
                  picture_url = COALESCE(?, picture_url), last_login_at = ?
            WHERE google_sub = ?`,
        )
        .run(
          email,
          input.emailVerified ? 1 : 0,
          input.name ?? null,
          input.pictureUrl ?? null,
          input.now,
          input.googleSub,
        );

      return (await this.getAdminUser(existing.admin_user_id as string))!;
    }

    const adminUserId = `admin_${nanoid(10)}`;
    this.db
      .prepare(
        `INSERT INTO admin_users
           (admin_user_id, google_sub, email, email_verified, name, picture_url, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        adminUserId,
        input.googleSub,
        email,
        input.emailVerified ? 1 : 0,
        input.name ?? null,
        input.pictureUrl ?? null,
        input.now,
        input.now,
      );

    return (await this.getAdminUser(adminUserId))!;
  }

  async getAdminUser(adminUserId: string): Promise<AdminUserRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM admin_users WHERE admin_user_id = ?`).get(adminUserId) as
      | Row
      | undefined;
    if (!row) return undefined;

    return compact({
      adminUserId: row.admin_user_id as string,
      googleSub: row.google_sub as string,
      email: row.email as string,
      emailVerified: row.email_verified === 1,
      name: row.name as string | null,
      pictureUrl: row.picture_url as string | null,
      createdAt: row.created_at as string,
      lastLoginAt: row.last_login_at as string,
    }) as AdminUserRecord;
  }

  async createAdminSession(input: CreateAdminSessionInput): Promise<AdminSessionRecord> {
    this.db
      .prepare(
        `INSERT INTO admin_sessions
           (session_id_hash, admin_user_id, created_at, expires_at, last_seen_at, revoked_at, user_agent_hash, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionIdHash,
        input.adminUserId,
        input.createdAt,
        input.expiresAt,
        input.lastSeenAt,
        input.revokedAt ?? null,
        input.userAgentHash ?? null,
        input.ipHash ?? null,
      );

    return input;
  }

  async getAdminSession(sessionIdHash: string): Promise<AdminSessionRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM admin_sessions WHERE session_id_hash = ?`).get(sessionIdHash) as
      | Row
      | undefined;
    if (!row) return undefined;

    return compact({
      sessionIdHash: row.session_id_hash as string,
      adminUserId: row.admin_user_id as string,
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string,
      lastSeenAt: row.last_seen_at as string,
      revokedAt: row.revoked_at as string | null,
      userAgentHash: row.user_agent_hash as string | null,
      ipHash: row.ip_hash as string | null,
    }) as AdminSessionRecord;
  }

  async revokeAdminSession(sessionIdHash: string, revokedAt: string): Promise<void> {
    this.db.prepare(`UPDATE admin_sessions SET revoked_at = ? WHERE session_id_hash = ?`).run(revokedAt, sessionIdHash);
  }

  async touchAdminSession(sessionIdHash: string, lastSeenAt: string): Promise<void> {
    this.db
      .prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE session_id_hash = ?`)
      .run(lastSeenAt, sessionIdHash);
  }

  async addProjectMembership(input: AddProjectMembershipInput): Promise<ProjectMembershipRecord> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_memberships (project_id, admin_user_id, role, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.projectId, input.adminUserId, input.role, input.createdAt);

    return input;
  }

  async getProjectMembership(
    projectId: string,
    adminUserId: string,
  ): Promise<ProjectMembershipRecord | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM project_memberships WHERE project_id = ? AND admin_user_id = ?`)
      .get(projectId, adminUserId) as Row | undefined;

    return row ? this.toMembership(row) : undefined;
  }

  async listProjectMembershipsForUser(adminUserId: string): Promise<ProjectMembershipRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM project_memberships WHERE admin_user_id = ?`)
      .all(adminUserId) as Row[];

    return rows.map((row) => this.toMembership(row));
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audit_logs (audit_log_id, admin_user_id, action, project_id, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `audit_${nanoid(10)}`,
        input.adminUserId ?? null,
        input.action,
        input.projectId ?? null,
        input.createdAt,
        JSON.stringify(input.metadata ?? {}),
      );
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    const rows = this.db.prepare(`SELECT * FROM audit_logs ORDER BY created_at`).all() as Row[];

    return rows.map(
      (row) =>
        compact({
          auditLogId: row.audit_log_id as string,
          adminUserId: row.admin_user_id as string | null,
          action: row.action as string,
          projectId: row.project_id as string | null,
          createdAt: row.created_at as string,
          metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
        }) as AuditLogRecord,
    );
  }

  async saveBatch(batch: EventBatch): Promise<void> {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO events
         (event_id, project_id, session_id, page_id, timestamp, type, url_path, url_query_redacted,
          title_masked, element_selector_hash, element_role, element_text_masked_or_limited,
          x, y, viewport_x, viewport_y, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertAll = this.db.transaction((events: TraceEvent[]) => {
      for (const event of events) {
        insert.run(
          event.eventId,
          batch.projectId,
          event.sessionId,
          event.pageId,
          event.timestamp,
          event.type,
          event.urlPath,
          event.urlQueryRedacted ?? null,
          event.titleMasked ?? null,
          event.elementSelectorHash ?? null,
          event.elementRole ?? null,
          event.elementTextMaskedOrLimited ?? null,
          event.x ?? null,
          event.y ?? null,
          event.viewportX ?? null,
          event.viewportY ?? null,
          JSON.stringify(event.metadata ?? {}),
        );
      }
    });

    insertAll(batch.events);
  }

  async listEvents(projectId: string): Promise<TraceEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE project_id = ? ORDER BY timestamp`)
      .all(projectId) as Row[];

    return rows.map((row) => this.toEvent(row));
  }

  async upsertIssues(projectId: string, issues: Issue[]): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT OR REPLACE INTO issues
         (issue_id, project_id, issue_type, title, summary, affected_sessions_count, affected_users_count,
          severity_score, first_seen_at, last_seen_at, trend, related_url_path, related_feature_id,
          example_session_ids, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const upsertAll = this.db.transaction((records: Issue[]) => {
      for (const issue of records) {
        if (issue.projectId !== projectId) continue;
        upsert.run(
          issue.issueId,
          issue.projectId,
          issue.issueType,
          issue.title,
          issue.summary,
          issue.affectedSessionsCount,
          issue.affectedUsersCount,
          issue.severityScore,
          issue.firstSeenAt,
          issue.lastSeenAt,
          issue.trend,
          issue.relatedUrlPath ?? null,
          issue.relatedFeatureId ?? null,
          JSON.stringify(issue.exampleSessionIds ?? []),
          issue.status,
        );
      }
    });

    upsertAll(issues);
  }

  async listIssues(projectId: string): Promise<Issue[]> {
    const rows = this.db
      .prepare(`SELECT * FROM issues WHERE project_id = ? ORDER BY severity_score DESC`)
      .all(projectId) as Row[];

    return rows.map((row) => this.toIssue(row));
  }

  async getIssue(issueId: string): Promise<Issue | undefined> {
    const row = this.db.prepare(`SELECT * FROM issues WHERE issue_id = ?`).get(issueId) as Row | undefined;

    return row ? this.toIssue(row) : undefined;
  }

  async getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE project_id = ? AND session_id = ? ORDER BY timestamp`)
      .all(projectId, sessionId) as Row[];

    return rows.map((row) => this.toEvent(row));
  }

  async getDashboardSummary(projectId: string): Promise<DashboardSummary> {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM events WHERE project_id = ?`)
      .get(projectId) as { total: number };

    return buildDashboardSummary(await this.listIssues(projectId), row.total);
  }

  private toMembership(row: Row): ProjectMembershipRecord {
    return {
      projectId: row.project_id as string,
      adminUserId: row.admin_user_id as string,
      role: row.role as AdminRole,
      createdAt: row.created_at as string,
    };
  }

  private toEvent(row: Row): TraceEvent {
    return compact({
      eventId: row.event_id as string,
      sessionId: row.session_id as string,
      pageId: row.page_id as string,
      timestamp: row.timestamp as string,
      type: row.type as TraceEvent["type"],
      urlPath: row.url_path as string,
      urlQueryRedacted: row.url_query_redacted as string | null,
      titleMasked: row.title_masked as string | null,
      elementSelectorHash: row.element_selector_hash as string | null,
      elementRole: row.element_role as string | null,
      elementTextMaskedOrLimited: row.element_text_masked_or_limited as string | null,
      x: row.x as number | null,
      y: row.y as number | null,
      viewportX: row.viewport_x as number | null,
      viewportY: row.viewport_y as number | null,
      metadata: JSON.parse(row.metadata as string) as TraceEvent["metadata"],
    }) as TraceEvent;
  }

  private toIssue(row: Row): Issue {
    return compact({
      issueId: row.issue_id as string,
      projectId: row.project_id as string,
      issueType: row.issue_type as Issue["issueType"],
      title: row.title as string,
      summary: row.summary as string,
      affectedSessionsCount: row.affected_sessions_count as number,
      affectedUsersCount: row.affected_users_count as number,
      severityScore: row.severity_score as number,
      firstSeenAt: row.first_seen_at as string,
      lastSeenAt: row.last_seen_at as string,
      trend: row.trend as Issue["trend"],
      relatedUrlPath: row.related_url_path as string | null,
      relatedFeatureId: row.related_feature_id as string | null,
      exampleSessionIds: JSON.parse(row.example_session_ids as string) as string[],
      status: row.status as Issue["status"],
    }) as Issue;
  }
}
