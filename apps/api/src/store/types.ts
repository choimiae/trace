import type { DashboardSummary, EventBatch, Issue, TraceEvent } from "@trace/shared";

export interface ProjectRecord {
  projectId: string;
  name: string;
  allowedDomains: string[];
  privacyConfig: { strictMasking: true; queryRedaction: true; inputCapture: false };
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  allowedDomains: string[];
}

export interface UpdateProjectInput {
  name: string;
  allowedDomains: string[];
}

export function normalizeAllowedDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map((domain) => new URL(domain).origin)));
}

export type AdminRole = "owner" | "admin" | "viewer";

export interface AdminUserRecord {
  adminUserId: string;
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  pictureUrl?: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface AdminSessionRecord {
  sessionIdHash: string;
  adminUserId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  userAgentHash?: string;
  ipHash?: string;
}

export interface ProjectMembershipRecord {
  projectId: string;
  adminUserId: string;
  role: AdminRole;
  createdAt: string;
}

export interface AuditLogRecord {
  auditLogId: string;
  adminUserId?: string;
  action: string;
  projectId?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface UpsertAdminUserFromGoogleInput {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  pictureUrl?: string;
  now: string;
}

export interface CreateAdminSessionInput extends AdminSessionRecord {}

export interface AddProjectMembershipInput {
  projectId: string;
  adminUserId: string;
  role: AdminRole;
  createdAt: string;
}

export interface CreateAuditLogInput {
  adminUserId?: string;
  action: string;
  projectId?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export type ProjectMembershipAuditLogFactory = (current: ProjectMembershipRecord) => CreateAuditLogInput;

export interface StoredSession {
  sessionId: string;
  projectId: string;
  anonymousUserId: string;
  startedAt: string;
  endedAt?: string;
}

export interface TraceStore {
  readonly isDurable?: boolean;
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  getProject(projectId: string): Promise<ProjectRecord | undefined>;
  updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined>;
  upsertAdminUserFromGoogle(input: UpsertAdminUserFromGoogleInput): Promise<AdminUserRecord>;
  getAdminUser(adminUserId: string): Promise<AdminUserRecord | undefined>;
  getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined>;
  createAdminSession(input: CreateAdminSessionInput): Promise<AdminSessionRecord>;
  getAdminSession(sessionIdHash: string): Promise<AdminSessionRecord | undefined>;
  revokeAdminSession(sessionIdHash: string, revokedAt: string): Promise<void>;
  touchAdminSession(sessionIdHash: string, lastSeenAt: string): Promise<void>;
  addProjectMembership(input: AddProjectMembershipInput): Promise<ProjectMembershipRecord>;
  addProjectMembershipWithAudit(
    membership: AddProjectMembershipInput,
    auditLog: CreateAuditLogInput,
  ): Promise<ProjectMembershipRecord>;
  updateProjectMembershipRoleWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    role: AdminRole;
    auditLog?: ProjectMembershipAuditLogFactory;
  }): Promise<ProjectMembershipRecord | undefined>;
  removeProjectMembershipWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    auditLog: ProjectMembershipAuditLogFactory;
  }): Promise<boolean>;
  getProjectMembership(projectId: string, adminUserId: string): Promise<ProjectMembershipRecord | undefined>;
  listProjectMembershipsForUser(adminUserId: string): Promise<ProjectMembershipRecord[]>;
  listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]>;
  createAuditLog(input: CreateAuditLogInput): Promise<void>;
  listAuditLogs(): Promise<AuditLogRecord[]>;
  saveBatch(batch: EventBatch): Promise<void>;
  listEvents(projectId: string): Promise<TraceEvent[]>;
  upsertIssues(projectId: string, issues: Issue[]): Promise<void>;
  listIssues(projectId: string): Promise<Issue[]>;
  getIssue(issueId: string): Promise<Issue | undefined>;
  getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]>;
  getDashboardSummary(projectId: string): Promise<DashboardSummary>;
}

export function assertDeployableTraceStore(store: TraceStore, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production" && store.isDurable !== true) {
    throw new Error("DURABLE_TRACE_STORE_REQUIRED");
  }
}
