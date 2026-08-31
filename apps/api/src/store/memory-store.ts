import type { DashboardSummary, EventBatch, Issue, TraceEvent } from "@trace/shared";
import { nanoid } from "nanoid";
import { buildDashboardSummary } from "./dashboard-summary.js";
import { normalizeAllowedDomains } from "./types.js";
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
  TraceStore,
  UpdateProjectInput,
  UpsertAdminUserFromGoogleInput,
} from "./types.js";

export class MemoryStore implements TraceStore {
  readonly isDurable = false;

  private projects = new Map<string, ProjectRecord>();
  private events = new Map<string, TraceEvent[]>();
  private issues = new Map<string, Issue>();
  private adminUsers = new Map<string, AdminUserRecord>();
  private adminUsersByEmail = new Map<string, string>();
  private adminSessions = new Map<string, AdminSessionRecord>();
  private projectMemberships = new Map<string, ProjectMembershipRecord>();
  private auditLogs = new Map<string, AuditLogRecord>();

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project: ProjectRecord = {
      projectId: `proj_${nanoid(10)}`,
      name: input.name,
      allowedDomains: input.allowedDomains,
      privacyConfig: { strictMasking: true, queryRedaction: true, inputCapture: false },
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.projectId, project);
    return project;
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    return this.projects.get(projectId);
  }

  async updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined> {
    const existing = this.projects.get(projectId);
    if (!existing) return undefined;

    const updated: ProjectRecord = {
      ...existing,
      name: input.name,
      allowedDomains: normalizeAllowedDomains(input.allowedDomains),
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

  async searchAdminUsers(input: { query: string; limit: number }): Promise<AdminUserRecord[]> {
    const needle = input.query.toLowerCase();
    return [...this.adminUsers.values()]
      .filter((user) => {
        if (needle === "") return true;
        if (user.email.toLowerCase().includes(needle)) return true;
        return user.name !== undefined && user.name.toLowerCase().includes(needle);
      })
      .sort((left, right) => left.email.localeCompare(right.email))
      .slice(0, input.limit);
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

  async addProjectMembership(input: AddProjectMembershipInput): Promise<ProjectMembershipRecord> {
    const key = `${input.projectId}:${input.adminUserId}`;
    if (this.projectMemberships.has(key)) throw new Error("project_member_exists");
    this.projectMemberships.set(key, input);
    return input;
  }

  async addProjectMembershipWithAudit(
    membership: AddProjectMembershipInput,
    auditLog: CreateAuditLogInput,
  ): Promise<ProjectMembershipRecord> {
    const key = `${membership.projectId}:${membership.adminUserId}`;
    if (this.projectMemberships.has(key)) throw new Error("project_member_exists");

    this.projectMemberships.set(key, membership);
    this.appendAuditLog(auditLog);
    return membership;
  }

  async updateProjectMembershipRoleWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    role: AdminRole;
    auditLog?: ProjectMembershipAuditLogFactory;
  }): Promise<ProjectMembershipRecord | undefined> {
    const requester = this.projectMemberships.get(`${input.projectId}:${input.requestedByAdminUserId}`);
    if (!requester || requester.role !== "owner") throw new Error("project_role_forbidden");

    const key = `${input.projectId}:${input.targetAdminUserId}`;
    const current = this.projectMemberships.get(key);
    if (!current) return undefined;
    if (current.role === input.role) return current;
    if (input.targetAdminUserId === input.requestedByAdminUserId && current.role === "owner") {
      throw new Error("self_owner_change_forbidden");
    }
    if (current.role === "owner" && input.role !== "owner" && this.ownerCount(input.projectId) <= 1) {
      throw new Error("last_owner_forbidden");
    }

    const auditLog = input.auditLog?.(current);
    const updated: ProjectMembershipRecord = { ...current, role: input.role };
    this.projectMemberships.set(key, updated);
    if (auditLog) this.appendAuditLog(auditLog);
    return updated;
  }

  async removeProjectMembershipWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    auditLog: ProjectMembershipAuditLogFactory;
  }): Promise<boolean> {
    const requester = this.projectMemberships.get(`${input.projectId}:${input.requestedByAdminUserId}`);
    if (!requester || requester.role !== "owner") throw new Error("project_role_forbidden");

    const key = `${input.projectId}:${input.targetAdminUserId}`;
    const current = this.projectMemberships.get(key);
    if (!current) return false;
    if (input.targetAdminUserId === input.requestedByAdminUserId) {
      throw new Error("self_owner_change_forbidden");
    }
    if (current.role === "owner" && this.ownerCount(input.projectId) <= 1) {
      throw new Error("last_owner_forbidden");
    }

    const auditLog = input.auditLog(current);
    this.projectMemberships.delete(key);
    this.appendAuditLog(auditLog);
    return true;
  }

  async getProjectMembership(
    projectId: string,
    adminUserId: string,
  ): Promise<ProjectMembershipRecord | undefined> {
    return this.projectMemberships.get(`${projectId}:${adminUserId}`);
  }

  async listProjectMembershipsForUser(adminUserId: string): Promise<ProjectMembershipRecord[]> {
    return [...this.projectMemberships.values()].filter((membership) => membership.adminUserId === adminUserId);
  }

  async listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]> {
    return Array.from(this.projectMemberships.values()).filter((membership) => membership.projectId === projectId);
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<void> {
    this.appendAuditLog(input);
  }

  private appendAuditLog(input: CreateAuditLogInput): void {
    const auditLog: AuditLogRecord = {
      auditLogId: `audit_${nanoid(10)}`,
      ...(input.adminUserId === undefined ? {} : { adminUserId: input.adminUserId }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      action: input.action,
      metadata: input.metadata,
      createdAt: input.createdAt,
    };
    this.auditLogs.set(auditLog.auditLogId, auditLog);
  }

  private ownerCount(projectId: string): number {
    return Array.from(this.projectMemberships.values()).filter(
      (membership) => membership.projectId === projectId && membership.role === "owner",
    ).length;
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    return [...this.auditLogs.values()];
  }

  async saveBatch(batch: EventBatch): Promise<void> {
    const existing = this.events.get(batch.projectId) ?? [];
    const seen = new Set(existing.map((event) => event.eventId));
    const unique = batch.events.filter((event) => !seen.has(event.eventId));
    this.events.set(batch.projectId, [...existing, ...unique]);
  }

  async listEvents(projectId: string): Promise<TraceEvent[]> {
    return [...(this.events.get(projectId) ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async upsertIssues(projectId: string, issues: Issue[]): Promise<void> {
    for (const issue of issues) {
      if (issue.projectId === projectId) this.issues.set(issue.issueId, issue);
    }
  }

  async listIssues(projectId: string): Promise<Issue[]> {
    return [...this.issues.values()]
      .filter((issue) => issue.projectId === projectId)
      .sort((a, b) => b.severityScore - a.severityScore);
  }

  async getIssue(issueId: string): Promise<Issue | undefined> {
    return this.issues.get(issueId);
  }

  async getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]> {
    return (await this.listEvents(projectId)).filter((event) => event.sessionId === sessionId);
  }

  async getDashboardSummary(projectId: string): Promise<DashboardSummary> {
    const [issues, events] = await Promise.all([this.listIssues(projectId), this.listEvents(projectId)]);
    return buildDashboardSummary(issues, events.length);
  }
}
