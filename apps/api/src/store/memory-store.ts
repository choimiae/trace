import type { EventBatch, TraceEvent } from "@trace/shared";
import { DEFAULT_REPLAY_CONFIG } from "@trace/shared";
import { nanoid } from "nanoid";
import { computePageStats } from "./page-stats.js";
import {
  normalizeAllowedDomains,
} from "./types.js";
import type {
  AdminSessionRecord,
  AdminUserRecord,
  CreateAdminSessionInput,
  CreateProjectInput,
  PageStats,
  ProjectRecord,
  SessionSummary,
  SessionRecordingChunk,
  TraceStore,
  UpdateProjectInput,
  UpsertAdminUserFromGoogleInput,
} from "./types.js";

export class MemoryStore implements TraceStore {
  readonly isDurable = false;

  private projects = new Map<string, ProjectRecord>();
  private events = new Map<string, TraceEvent[]>();
  private adminUsers = new Map<string, AdminUserRecord>();
  private adminUsersByEmail = new Map<string, string>();
  private adminSessions = new Map<string, AdminSessionRecord>();
  private sessionRecordings = new Map<string, SessionRecordingChunk>();

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project: ProjectRecord = {
      projectId: `proj_${nanoid(10)}`,
      name: input.name,
      allowedDomains: input.allowedDomains,
      privacyConfig: { strictMasking: true, queryRedaction: true, inputCapture: false },
      replay: DEFAULT_REPLAY_CONFIG,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.projectId, project);
    return project;
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    return this.projects.get(projectId);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return [...this.projects.values()].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.projectId.localeCompare(right.projectId),
    );
  }

  async updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined> {
    const existing = this.projects.get(projectId);
    if (!existing) return undefined;

    const updated: ProjectRecord = {
      ...existing,
      name: input.name,
      allowedDomains: normalizeAllowedDomains(input.allowedDomains),
      replay: input.replay ?? existing.replay,
    };
    this.projects.set(projectId, updated);
    return updated;
  }

  async upsertAdminUserFromGoogle(input: UpsertAdminUserFromGoogleInput): Promise<AdminUserRecord> {
    const email = input.email.toLowerCase();
    const existing = this.adminUsers.get(input.googleSub);
    const googleSubForEmail = this.adminUsersByEmail.get(email);
    if (googleSubForEmail !== undefined && googleSubForEmail !== input.googleSub) {
      throw new Error("admin_email_conflict");
    }

    if (existing && existing.email !== email) {
      this.adminUsersByEmail.delete(existing.email);
    }

    const user: AdminUserRecord = existing
      ? {
          ...existing,
          email,
          emailVerified: input.emailVerified,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.pictureUrl === undefined ? {} : { pictureUrl: input.pictureUrl }),
          lastLoginAt: input.now,
        }
      : {
          adminUserId: `admin_${nanoid(10)}`,
          googleSub: input.googleSub,
          email,
          emailVerified: input.emailVerified,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.pictureUrl === undefined ? {} : { pictureUrl: input.pictureUrl }),
          createdAt: input.now,
          lastLoginAt: input.now,
        };

    this.adminUsers.set(input.googleSub, user);
    this.adminUsersByEmail.set(email, input.googleSub);
    return user;
  }

  async getAdminUser(adminUserId: string): Promise<AdminUserRecord | undefined> {
    return [...this.adminUsers.values()].find((user) => user.adminUserId === adminUserId);
  }

  async getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined> {
    const googleSub = this.adminUsersByEmail.get(email.toLowerCase());
    return googleSub ? this.adminUsers.get(googleSub) : undefined;
  }

  async createAdminSession(input: CreateAdminSessionInput): Promise<AdminSessionRecord> {
    this.adminSessions.set(input.sessionIdHash, input);
    return input;
  }

  async getAdminSession(sessionIdHash: string): Promise<AdminSessionRecord | undefined> {
    return this.adminSessions.get(sessionIdHash);
  }

  async revokeAdminSession(sessionIdHash: string, revokedAt: string): Promise<void> {
    const session = this.adminSessions.get(sessionIdHash);
    if (session) this.adminSessions.set(sessionIdHash, { ...session, revokedAt });
  }

  async touchAdminSession(sessionIdHash: string, lastSeenAt: string): Promise<void> {
    const session = this.adminSessions.get(sessionIdHash);
    if (session) this.adminSessions.set(sessionIdHash, { ...session, lastSeenAt });
  }

  async saveBatch(batch: EventBatch): Promise<void> {
    const existing = this.events.get(batch.projectId) ?? [];
    const seen = new Set(existing.map((event) => event.eventId));
    const unique = batch.events.filter((event) => !seen.has(event.eventId));
    this.events.set(batch.projectId, [...existing, ...unique]);
  }

  async deleteEventsBefore(cutoff: string): Promise<number> {
    let deleted = 0;
    for (const [projectId, events] of this.events) {
      const retained = events.filter((event) => event.timestamp >= cutoff);
      deleted += events.length - retained.length;
      this.events.set(projectId, retained);
    }
    return deleted;
  }

  private async loadEvents(projectId: string): Promise<TraceEvent[]> {
    return [...(this.events.get(projectId) ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async listPageStats(projectId: string, limit: number): Promise<PageStats[]> {
    const events = await this.loadEvents(projectId);
    return computePageStats(events, limit);
  }

  async getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]> {
    return (await this.loadEvents(projectId)).filter((event) => event.sessionId === sessionId);
  }

  async saveSessionRecordingChunk(chunk: SessionRecordingChunk): Promise<void> {
    const key = `${chunk.sessionId}:${chunk.seq}`;
    if (this.sessionRecordings.has(key)) return;
    this.sessionRecordings.set(key, { ...chunk, bytes: new Uint8Array(chunk.bytes) });
  }

  async listSessionRecordingChunks(projectId: string, sessionId: string): Promise<SessionRecordingChunk[]> {
    return Array.from(this.sessionRecordings.values())
      .filter((chunk) => chunk.projectId === projectId && chunk.sessionId === sessionId)
      .sort((a, b) => a.seq - b.seq);
  }

  async getSessionRecordingChunk(
    projectId: string,
    sessionId: string,
    seq: number,
  ): Promise<SessionRecordingChunk | undefined> {
    const chunk = this.sessionRecordings.get(`${sessionId}:${seq}`);
    if (!chunk || chunk.projectId !== projectId) return undefined;
    return { ...chunk, bytes: new Uint8Array(chunk.bytes) };
  }

  async listSessions(projectId: string, limit: number): Promise<SessionSummary[]> {
    const recorded = new Set(
      Array.from(this.sessionRecordings.values())
        .filter((chunk) => chunk.projectId === projectId)
        .map((chunk) => chunk.sessionId),
    );
    const bySession = new Map<string, SessionSummary>();

    for (const event of this.events.get(projectId) ?? []) {
      const current = bySession.get(event.sessionId);
      if (!current) {
        bySession.set(event.sessionId, {
          sessionId: event.sessionId,
          startedAt: event.timestamp,
          lastSeenAt: event.timestamp,
          eventCount: 1,
          hasRecording: recorded.has(event.sessionId),
        });
        continue;
      }

      if (event.timestamp < current.startedAt) current.startedAt = event.timestamp;
      if (event.timestamp > current.lastSeenAt) current.lastSeenAt = event.timestamp;
      current.eventCount += 1;
    }

    return Array.from(bySession.values())
      .sort((a, b) => (a.startedAt === b.startedAt ? 0 : a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, limit);
  }

  // SqliteStore 와 같은 열을 본다 - received_at 이다. startedAt 으로 판정하면
  // 브라우저 시계 하나가 보존 창을 무한정 늘리거나 방금 받은 기록을 지운다.
  async deleteSessionRecordingsBefore(cutoff: string): Promise<number> {
    let deleted = 0;
    for (const [key, chunk] of this.sessionRecordings) {
      if (chunk.receivedAt < cutoff) {
        this.sessionRecordings.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}
