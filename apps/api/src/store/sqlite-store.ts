import type { EventBatch, ReplayConfig, TraceEvent } from "@trace/shared";
import { DEFAULT_REPLAY_CONFIG, replayConfigSchema } from "@trace/shared";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { SQLITE_SCHEMA } from "../db/schema.sqlite.js";
import { Analytics } from "./analytics.js";
import { elementKey } from "./element-key.js";
import { computePageStats } from "./page-stats.js";
import {
  normalizeAllowedDomains,
} from "./types.js";
import type {
  AdminSessionRecord,
  AdminUserRecord,
  CreateAdminSessionInput,
  CreateProjectInput,
  FeatureUsage,
  PageStats,
  PathRanking,
  ProjectRecord,
  SessionList,
  SessionListQuery,
  SessionRecordingChunk,
  TraceStore,
  UpdateProjectInput,
  UpsertAdminUserFromGoogleInput,
} from "./types.js";

type Row = Record<string, unknown>;

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as T;
}

// 저장된 값이 깨졌거나 예전 형식이면 꺼진 설정으로 돌아간다. 여기서 던지면
// 프로젝트 조회가 통째로 실패해 수집까지 멈춘다 — 리플레이가 꺼지는 쪽이 낫다.
function parseReplayConfig(value: unknown): ReplayConfig {
  if (typeof value !== "string") return DEFAULT_REPLAY_CONFIG;
  try {
    const parsed = replayConfigSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : DEFAULT_REPLAY_CONFIG;
  } catch {
    return DEFAULT_REPLAY_CONFIG;
  }
}

export class SqliteStore implements TraceStore {
  private readonly db: Database.Database;
  private readonly analytics: Analytics;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    if (filePath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.exec(SQLITE_SCHEMA);
    this.createDebugViews();
    this.analytics = new Analytics(this.db);
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
      replay: DEFAULT_REPLAY_CONFIG,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO projects (project_id, name, allowed_domains, privacy_config, replay_config, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.projectId,
        project.name,
        JSON.stringify(project.allowedDomains),
        JSON.stringify(project.privacyConfig),
        JSON.stringify(project.replay),
        project.createdAt,
      );

    return project;
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM projects WHERE project_id = ?`).get(projectId) as Row | undefined;
    return row ? this.toProjectRecord(row) : undefined;
  }

  private toProjectRecord(row: Row): ProjectRecord {
    return {
      projectId: row.project_id as string,
      name: row.name as string,
      allowedDomains: JSON.parse(row.allowed_domains as string) as string[],
      privacyConfig: JSON.parse(row.privacy_config as string) as ProjectRecord["privacyConfig"],
      replay: parseReplayConfig(row.replay_config),
      createdAt: row.created_at as string,
    };
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM projects ORDER BY created_at ASC, project_id ASC`)
      .all() as Row[];
    return rows.map((row) => this.toProjectRecord(row));
  }

  async updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined> {
    const existing = await this.getProject(projectId);
    if (!existing) return undefined;
    const allowedDomains = normalizeAllowedDomains(input.allowedDomains);
    const replay = input.replay ?? existing.replay;

    this.db
      .prepare(`UPDATE projects SET name = ?, allowed_domains = ?, replay_config = ? WHERE project_id = ?`)
      .run(input.name, JSON.stringify(allowedDomains), JSON.stringify(replay), projectId);

    return {
      ...existing,
      name: input.name,
      allowedDomains,
      replay,
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

  async saveBatch(batch: EventBatch): Promise<void> {
    const receivedAt = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO events
         (event_id, project_id, session_id, anonymous_user_id, page_id, timestamp, received_at, type, url_path, url_query_redacted,
          title_masked, element_selector_hash, element_role, element_text_masked_or_limited,
          x, y, viewport_x, viewport_y, metadata, element_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertAll = this.db.transaction((events: TraceEvent[]) => {
      for (const event of events) {
        insert.run(
          event.eventId,
          batch.projectId,
          event.sessionId,
          batch.anonymousUserId,
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
          elementKey(event) ?? null,
        );
      }
    });

    insertAll(batch.events);
  }

  async deleteEventsBefore(cutoff: string): Promise<number> {
    const result = this.db.prepare(`DELETE FROM events WHERE timestamp < ?`).run(cutoff);
    return result.changes;
  }

  private async loadEvents(projectId: string): Promise<TraceEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE project_id = ? ORDER BY timestamp`)
      .all(projectId) as Row[];

    return rows.map((row) => this.toEvent(row));
  }

  async listPageStats(projectId: string, limit: number): Promise<PageStats[]> {
    const events = await this.loadEvents(projectId);
    return computePageStats(events, limit);
  }

  async getFeatureUsage(projectId: string, since: string): Promise<FeatureUsage> {
    return this.analytics.featureUsage(projectId, since);
  }

  async getPathRanking(projectId: string, since: string, start?: string): Promise<PathRanking> {
    return this.analytics.pathRanking(projectId, since, start);
  }

  async getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE project_id = ? AND session_id = ? ORDER BY timestamp`)
      .all(projectId, sessionId) as Row[];

    return rows.map((row) => this.toEvent(row));
  }

  async saveSessionRecordingChunk(chunk: SessionRecordingChunk): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO session_recordings
           (session_id, project_id, seq, started_at, received_at, event_count, bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chunk.sessionId,
        chunk.projectId,
        chunk.seq,
        chunk.startedAt,
        chunk.receivedAt,
        chunk.eventCount,
        Buffer.from(chunk.bytes),
      );
  }

  async listSessionRecordingChunks(projectId: string, sessionId: string): Promise<SessionRecordingChunk[]> {
    const rows = this.db
      .prepare(
        `SELECT session_id, project_id, seq, started_at, received_at, event_count, bytes
           FROM session_recordings
          WHERE project_id = ? AND session_id = ?
          ORDER BY seq ASC`,
      )
      .all(projectId, sessionId) as Row[];

    return rows.map((row) => ({
      sessionId: row.session_id as string,
      projectId: row.project_id as string,
      seq: row.seq as number,
      startedAt: row.started_at as string,
      receivedAt: row.received_at as string,
      eventCount: row.event_count as number,
      bytes: new Uint8Array(row.bytes as Buffer),
    }));
  }

  async listSessions(projectId: string, query: SessionListQuery): Promise<SessionList> {
    return this.analytics.sessions(projectId, query);
  }

  async getSessionRecordingChunk(
    projectId: string,
    sessionId: string,
    seq: number,
  ): Promise<SessionRecordingChunk | undefined> {
    const row = this.db
      .prepare(
        `SELECT session_id, project_id, seq, started_at, received_at, event_count, bytes
           FROM session_recordings
          WHERE project_id = ? AND session_id = ? AND seq = ?`,
      )
      .get(projectId, sessionId, seq) as Row | undefined;
    if (!row) return undefined;

    return {
      sessionId: row.session_id as string,
      projectId: row.project_id as string,
      seq: row.seq as number,
      startedAt: row.started_at as string,
      receivedAt: row.received_at as string,
      eventCount: row.event_count as number,
      bytes: new Uint8Array(row.bytes as Buffer),
    };
  }

  // started_at 이 아니라 received_at 이다. started_at 은 브라우저 시계가 적어
  // 보낸 값이라, 시계가 어긋난 기기 하나가 보존 창을 무한정 늘리거나(2999년)
  // 방금 받은 기록을 같은 요청 안에서 지워 버린다(과거 날짜).
  async deleteSessionRecordingsBefore(cutoff: string): Promise<number> {
    return this.db.prepare(`DELETE FROM session_recordings WHERE received_at < ?`).run(cutoff).changes;
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
        element_key
      FROM events;
    `);
  }
}
