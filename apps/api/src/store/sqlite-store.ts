import type { DashboardSummary, EventBatch, Issue, TraceEvent } from "@trace/shared";
import { screenContextSchema } from "@trace/shared";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { SQLITE_SCHEMA } from "../db/schema.sqlite.js";
import { buildDashboardSummary } from "./dashboard-summary.js";
import {
  normalizeAllowedDomains,
  pickRepresentativeScreenContextEvent,
  SCREEN_CONTEXT_CANDIDATE_LIMIT,
} from "./types.js";
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
  ProjectMembershipAuditLogFactory,
  ProjectRecord,
  ScreenContextEventQuery,
  TraceStore,
  UpdateProjectInput,
  UpsertAdminUserFromGoogleInput,
} from "./types.js";

type Row = Record<string, unknown>;

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as T;
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function userVersion(db: Database.Database): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

export class SqliteStore implements TraceStore {
  readonly isDurable = true;
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    if (filePath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.exec(SQLITE_SCHEMA);
    this.migrate();
    this.createDebugViews();
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

  async updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined> {
    const existing = await this.getProject(projectId);
    if (!existing) return undefined;
    const allowedDomains = normalizeAllowedDomains(input.allowedDomains);

    this.db
      .prepare(`UPDATE projects SET name = ?, allowed_domains = ? WHERE project_id = ?`)
      .run(input.name, JSON.stringify(allowedDomains), projectId);

    return {
      ...existing,
      name: input.name,
      allowedDomains,
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

  private toAdminUserRecord(row: Row): AdminUserRecord {
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

  async getAdminUser(adminUserId: string): Promise<AdminUserRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM admin_users WHERE admin_user_id = ?`).get(adminUserId) as
      | Row
      | undefined;
    return row ? this.toAdminUserRecord(row) : undefined;
  }

  async getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM admin_users WHERE email = ?`).get(email.toLowerCase()) as
      | Row
      | undefined;
    return row ? this.toAdminUserRecord(row) : undefined;
  }

  async searchAdminUsers(input: { query: string; limit: number }): Promise<AdminUserRecord[]> {
    const needle = input.query.toLowerCase();
    // name 은 nullable 컬럼이다. COALESCE 로 감싸지 않으면 name 이 NULL 인 행에서
    // LOWER(name) LIKE ? 가 NULL 이 되어 email 조건만 맞는 사용자가 탈락한다.
    const rows = needle === ""
      ? (this.db
          .prepare(`SELECT * FROM admin_users ORDER BY email ASC LIMIT ?`)
          .all(input.limit) as Row[])
      : (this.db
          .prepare(
            `SELECT * FROM admin_users
             WHERE LOWER(email) LIKE ? OR LOWER(COALESCE(name, '')) LIKE ?
             ORDER BY email ASC LIMIT ?`,
          )
          .all(`%${needle}%`, `%${needle}%`, input.limit) as Row[]);

    return rows.map((row) => this.toAdminUserRecord(row));
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
    const result = this.db
      .prepare(
        `INSERT INTO project_memberships (project_id, admin_user_id, role, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, admin_user_id) DO NOTHING`,
      )
      .run(input.projectId, input.adminUserId, input.role, input.createdAt);
    if (result.changes === 0) throw new Error("project_member_exists");

    return input;
  }

  async addProjectMembershipWithAudit(
    membership: AddProjectMembershipInput,
    auditLog: CreateAuditLogInput,
  ): Promise<ProjectMembershipRecord> {
    const addMembershipAndAudit = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO project_memberships (project_id, admin_user_id, role, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(project_id, admin_user_id) DO NOTHING`,
        )
        .run(membership.projectId, membership.adminUserId, membership.role, membership.createdAt);
      if (result.changes === 0) throw new Error("project_member_exists");

      this.insertAuditLog(auditLog);
    });

    addMembershipAndAudit();
    return membership;
  }

  async updateProjectMembershipRoleWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    role: AdminRole;
    auditLog?: ProjectMembershipAuditLogFactory;
  }): Promise<ProjectMembershipRecord | undefined> {
    const updateMembershipAndAudit = this.db.transaction(() => {
      const requester = this.getProjectMembershipSync(input.projectId, input.requestedByAdminUserId);
      if (!requester || requester.role !== "owner") throw new Error("project_role_forbidden");

      const current = this.getProjectMembershipSync(input.projectId, input.targetAdminUserId);
      if (!current) return undefined;
      if (current.role === input.role) return current;
      if (input.targetAdminUserId === input.requestedByAdminUserId && current.role === "owner") {
        throw new Error("self_owner_change_forbidden");
      }
      if (current.role === "owner" && input.role !== "owner" && this.ownerCountSync(input.projectId) <= 1) {
        throw new Error("last_owner_forbidden");
      }

      this.db
        .prepare(
          `UPDATE project_memberships
           SET role = @role
           WHERE project_id = @projectId AND admin_user_id = @adminUserId`,
        )
        .run({ role: input.role, projectId: input.projectId, adminUserId: input.targetAdminUserId });
      if (input.auditLog) this.insertAuditLog(input.auditLog(current));
      return this.getProjectMembershipSync(input.projectId, input.targetAdminUserId);
    });

    return updateMembershipAndAudit();
  }

  async removeProjectMembershipWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    auditLog: ProjectMembershipAuditLogFactory;
  }): Promise<boolean> {
    const removeMembershipAndAudit = this.db.transaction(() => {
      const requester = this.getProjectMembershipSync(input.projectId, input.requestedByAdminUserId);
      if (!requester || requester.role !== "owner") throw new Error("project_role_forbidden");

      const current = this.getProjectMembershipSync(input.projectId, input.targetAdminUserId);
      if (!current) return false;
      if (input.targetAdminUserId === input.requestedByAdminUserId) {
        throw new Error("self_owner_change_forbidden");
      }
      if (current.role === "owner" && this.ownerCountSync(input.projectId) <= 1) {
        throw new Error("last_owner_forbidden");
      }

      this.db
        .prepare(
          `DELETE FROM project_memberships
           WHERE project_id = @projectId AND admin_user_id = @adminUserId`,
        )
        .run({ projectId: input.projectId, adminUserId: input.targetAdminUserId });
      this.insertAuditLog(input.auditLog(current));
      return true;
    });

    return removeMembershipAndAudit();
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

  async listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM project_memberships WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as Row[];

    return rows.map((row) => this.toMembership(row));
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<void> {
    this.insertAuditLog(input);
  }

  private insertAuditLog(input: CreateAuditLogInput): void {
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

  private toAuditLogRecord(row: Row): AuditLogRecord {
    return compact({
      auditLogId: row.audit_log_id as string,
      adminUserId: row.admin_user_id as string | null,
      action: row.action as string,
      projectId: row.project_id as string | null,
      createdAt: row.created_at as string,
      metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
    }) as AuditLogRecord;
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    const rows = this.db.prepare(`SELECT * FROM audit_logs ORDER BY created_at`).all() as Row[];

    return rows.map((row) => this.toAuditLogRecord(row));
  }

  async listProjectAuditLogs(input: {
    projectId: string;
    limit: number;
    cursor?: { createdAt: string; auditLogId: string };
  }): Promise<AuditLogRecord[]> {
    const { cursor } = input;
    const rows = cursor === undefined
      ? (this.db
          .prepare(
            `SELECT * FROM audit_logs
             WHERE project_id = ?
             ORDER BY created_at DESC, audit_log_id DESC
             LIMIT ?`,
          )
          .all(input.projectId, input.limit) as Row[])
      : (this.db
          .prepare(
            `SELECT * FROM audit_logs
             WHERE project_id = ?
               AND (created_at < ? OR (created_at = ? AND audit_log_id < ?))
             ORDER BY created_at DESC, audit_log_id DESC
             LIMIT ?`,
          )
          .all(
            input.projectId,
            cursor.createdAt,
            cursor.createdAt,
            cursor.auditLogId,
            input.limit,
          ) as Row[]);

    return rows.map((row) => this.toAuditLogRecord(row));
  }

  async saveBatch(batch: EventBatch): Promise<void> {
    const receivedAt = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO events
         (event_id, project_id, session_id, page_id, timestamp, received_at, type, url_path, url_query_redacted,
          title_masked, element_selector_hash, element_role, element_text_masked_or_limited,
          x, y, viewport_x, viewport_y, metadata, screen_context, error_name, error_source, error_line)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertAll = this.db.transaction((events: TraceEvent[]) => {
      for (const event of events) {
        insert.run(
          event.eventId,
          batch.projectId,
          event.sessionId,
          event.pageId,
          event.timestamp,
          receivedAt,
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
          event.screenContext ? JSON.stringify(event.screenContext) : null,
          event.errorName ?? null,
          event.errorSource ?? null,
          event.errorLine ?? null,
        );
      }
    });

    insertAll(batch.events);
  }

  async deleteEventsBefore(cutoff: string): Promise<number> {
    const result = this.db.prepare(`DELETE FROM events WHERE timestamp < ?`).run(cutoff);
    return result.changes;
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
          example_session_ids, status, related_error_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          issue.relatedErrorSignature ?? null,
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

  async findScreenContextEvents(query: ScreenContextEventQuery): Promise<TraceEvent[]> {
    if (query.sessionIds.length === 0) return [];

    const pathFilter = query.urlPath === undefined ? "" : " AND url_path = ?";
    const typeFilter =
      query.types === undefined || query.types.length === 0
        ? ""
        : ` AND type IN (${query.types.map(() => "?").join(", ")})`;
    // (project_id, session_id, timestamp) 인덱스로 세션마다 후보 몇 건만 읽는다.
    // 한 행만 읽으면 클릭 지점 없는 프레임뿐인 이벤트나 파싱 불가한 행이 그 자리를
    // 차지해 버리므로, 후보 상한까지 읽고 pickRepresentative... 로 고른다.
    const statement = this.db.prepare(
      `SELECT * FROM events
       WHERE project_id = ? AND session_id = ? AND screen_context IS NOT NULL${pathFilter}
         AND timestamp BETWEEN ? AND ?${typeFilter}
       ORDER BY timestamp
       LIMIT ${SCREEN_CONTEXT_CANDIDATE_LIMIT}`,
    );
    const matched: TraceEvent[] = [];

    for (const sessionId of query.sessionIds) {
      const rows = statement.all(
        query.projectId,
        sessionId,
        ...(query.urlPath === undefined ? [] : [query.urlPath]),
        query.from,
        query.to,
        ...(query.types ?? []),
      ) as Row[];
      const candidates = rows
        .map((row) => this.toEvent(row))
        .filter((event) => event.screenContext !== undefined);
      const picked = pickRepresentativeScreenContextEvent(candidates);
      if (picked) matched.push(picked);
    }

    return matched;
  }

  async getDashboardSummary(projectId: string): Promise<DashboardSummary> {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM events WHERE project_id = ?`)
      .get(projectId) as { total: number };

    return buildDashboardSummary(await this.listIssues(projectId), row.total);
  }

  private getProjectMembershipSync(projectId: string, adminUserId: string): ProjectMembershipRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT project_id, admin_user_id, role, created_at
         FROM project_memberships
         WHERE project_id = @projectId AND admin_user_id = @adminUserId`,
      )
      .get({ projectId, adminUserId }) as Row | undefined;
    return row ? this.toMembership(row) : undefined;
  }

  private ownerCountSync(projectId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM project_memberships
         WHERE project_id = @projectId AND role = 'owner'`,
      )
      .get({ projectId }) as { count: number };
    return row.count;
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
    const screenContext = this.parseScreenContext(row.screen_context as string | null);

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
      errorName: row.error_name as string | null,
      errorSource: row.error_source as string | null,
      errorLine: row.error_line as number | null,
      ...(screenContext ? { screenContext } : {}),
    }) as TraceEvent;
  }

  private parseScreenContext(rawScreenContext: string | null): TraceEvent["screenContext"] | undefined {
    if (!rawScreenContext) return undefined;

    try {
      const parsed = screenContextSchema.safeParse(JSON.parse(rawScreenContext));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
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
      relatedErrorSignature: row.related_error_signature as string | null,
    }) as Issue;
  }

  private migrate(): void {
    if (!hasColumn(this.db, "events", "received_at")) {
      this.db.exec(`
        ALTER TABLE events ADD COLUMN received_at TEXT;
        UPDATE events SET received_at = timestamp WHERE received_at IS NULL;
      `);
    }
    if (!hasColumn(this.db, "events", "screen_context")) {
      this.db.exec("ALTER TABLE events ADD COLUMN screen_context TEXT");
    }
    for (const column of ["error_name", "error_source"]) {
      if (!hasColumn(this.db, "events", column)) {
        this.db.exec(`ALTER TABLE events ADD COLUMN ${column} TEXT`);
      }
    }
    if (!hasColumn(this.db, "events", "error_line")) {
      this.db.exec("ALTER TABLE events ADD COLUMN error_line INTEGER");
    }
    if (!hasColumn(this.db, "issues", "related_error_signature")) {
      this.db.exec("ALTER TABLE issues ADD COLUMN related_error_signature TEXT");
    }

    // 요소 지문 규칙이 바뀌었다. 과거 이벤트는 옛 규칙 지문을 들고 있고
    // detectIssues 는 배치마다 저장된 전체 이벤트에 대해 다시 도므로(ingestion.ts
    // 의 listEvents), 그대로 두면 옛 규칙 이슈가 영구히 재생성되어 같은 버튼을
    // 이중 집계한다. 이벤트 보존은 기본값이 없어 과거 이벤트가 만료되지도 않는다.
    //
    // 반복 실행되면 새 이벤트의 지문까지 지우므로 user_version 으로 한 번만 돌린다.
    // 기존 마이그레이션은 컬럼 추가형이라 버전 카운터를 쓰지 않았다.
    if (userVersion(this.db) < 1) {
      // 탐지기가 지문 없는 클릭을 이미 건너뛰므로 옛 규칙 이슈는 재생성되지 않는다.
      //
      // 부분 문자열 포함 검사(NOT LIKE '%|page|%')는 두 방향 모두에서 틀릴 수 있다.
      // urlPath 안에 `|` 가 섞여 들어오면(issueTargetKey 의 허용 문자셋이 `|` 를
      // 포함해 치환하지 않는다) 지문 키 이슈의 id 에도 우연히 "|page|" 부분 문자열이
      // 생겨 잘못 살아남는다. 반대로 detectErrorFriction 도 다른 탐지기처럼
      // elementKey(event) 를 그대로 넘기므로 — 오류 이벤트가 지문을 안 갖는 것은
      // 오늘 SDK 의 우연이지 계약이 아니다 — issue_type 만으로 오류 이슈를 통째로
      // 봐줄 수 없다. 지문 키를 가진 error_friction 이슈는 다른 지문 키 이슈와
      // 동일하게 지워져야 맞다(지문이 NULL 이 되면 다음 배치에서 page 키로 다시
      // 감지된다).
      //
      // 대신 꼬리를 정확히 비교한다. 이슈 id 의 꼬리는 언제나 `|{키}|{issue_type}`
      // 이고, 이 꼬리가 정확히 `|page|{issue_type}` 와 같다는 것은 키가 정확히
      // "page" 라는 것과 동치다 — 키는 16자 16진수 해시이거나 리터럴 "page" 뿐이라
      // 16진수 16자는 "page" 와 절대 같을 수 없다. urlPath 안의 `|` 는 접미사
      // 비교에 영향을 주지 못한다. LIKE 는 쓰지 않는다 — issue_type 자체가 `_`
      // (LIKE 의 단일 문자 와일드카드)를 담고 있어(rage_click, dead_click_cluster)
      // issue_type 으로 지은 LIKE 패턴은 느슨하게 맞아버린다. substr + <> 는 정확한
      // 문자열 비교라 그런 오탐이 없다.
      const purgeStaleFingerprints = this.db.transaction(() => {
        this.db.exec(`
          UPDATE events SET element_selector_hash = NULL;
          DELETE FROM issues
            WHERE substr(issue_id, -length('|page|' || issue_type)) <> '|page|' || issue_type;
          PRAGMA user_version = 1;
        `);
      });
      purgeStaleFingerprints();
    }
  }

  private createDebugViews(): void {
    this.db.exec(`
      DROP VIEW IF EXISTS events_debug;

      CREATE VIEW events_debug AS
      SELECT
        event_id,
        project_id,
        session_id,
        page_id,
        timestamp AS occurred_at_utc,
        strftime('%Y-%m-%d %H:%M:%f', timestamp, '+9 hours') AS occurred_at_kst,
        received_at AS received_at_utc,
        strftime('%Y-%m-%d %H:%M:%f', received_at, '+9 hours') AS received_at_kst,
        type,
        url_path,
        url_query_redacted,
        title_masked,
        element_selector_hash,
        element_role,
        element_text_masked_or_limited,
        x,
        y,
        viewport_x,
        viewport_y,
        metadata,
        screen_context,
        error_name,
        error_source,
        error_line
      FROM events;
    `);
  }
}
