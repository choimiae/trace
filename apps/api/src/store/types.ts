import type { DashboardSummary, EventBatch, Issue, ReplayConfig, TraceEvent } from "@trace/shared";

export interface ProjectRecord {
  projectId: string;
  name: string;
  allowedDomains: string[];
  privacyConfig: { strictMasking: true; queryRedaction: true; inputCapture: false };
  replay: ReplayConfig;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  allowedDomains: string[];
}

export interface UpdateProjectInput {
  name: string;
  allowedDomains: string[];
  // 넘기지 않으면 기존 설정을 유지한다. 관리자 화면이 리플레이 항목을 보내지
  // 않는 동안 이름만 고친 요청이 기록을 꺼 버리지 않게 하기 위한 것이다.
  replay?: ReplayConfig;
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

/**
 * findScreenContextEvents 가 세션마다 살펴보는 후보 이벤트 상한. 두 스토어 구현이
 * 같은 이벤트를 고르도록 계약으로 고정한다.
 */
export const SCREEN_CONTEXT_CANDIDATE_LIMIT = 10;

/**
 * 후보 중 클릭 지점이 있는 가장 이른 이벤트를 고르고, 없으면 프레임만 있는 가장 이른
 * 이벤트를 쓴다. 두 스토어가 공유한다.
 */
export function pickRepresentativeScreenContextEvent(candidates: TraceEvent[]): TraceEvent | undefined {
  const withinLimit = candidates.slice(0, SCREEN_CONTEXT_CANDIDATE_LIMIT);
  return withinLimit.find((event) => event.screenContext?.target !== undefined) ?? withinLimit[0];
}

export interface ScreenContextEventQuery {
  projectId: string;
  sessionIds: string[];
  urlPath?: string;
  from: string;
  to: string;
  types?: TraceEvent["type"][];
  // 넘기면 그 요소의 이벤트만 후보가 된다. 안 넘기면 요소로 거르지 않는다 —
  // 요소를 모르는 이슈(long_pause·error_friction)가 그 경로를 쓴다.
  elementKey?: string;
}

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
  searchAdminUsers(input: { query: string; limit: number }): Promise<AdminUserRecord[]>;
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
  listProjectAuditLogs(input: {
    projectId: string;
    limit: number;
    cursor?: { createdAt: string; auditLogId: string };
  }): Promise<AuditLogRecord[]>;
  saveBatch(batch: EventBatch): Promise<void>;
  deleteEventsBefore(cutoff: string): Promise<number>;
  listEvents(projectId: string): Promise<TraceEvent[]>;
  upsertIssues(projectId: string, issues: Issue[]): Promise<void>;
  listIssues(projectId: string): Promise<Issue[]>;
  getIssue(issueId: string): Promise<Issue | undefined>;
  getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]>;
  /**
   * 세션마다 조건(화면 맥락 보유, urlPath, 시간 창, 이벤트 타입)에 맞는 이벤트를
   * 하나씩 돌려준다. 입력한 sessionIds 순서를 유지하고 일치가 없는 세션은 결과에서
   * 빠진다. 대시보드 첫 화면이 이슈마다 세션 타임라인 전체를 읽지 않게 하려고
   * 인덱스 질의로 대표 이벤트만 가져오는 용도다.
   *
   * 세션 안에서는 시간순 앞선 SCREEN_CONTEXT_CANDIDATE_LIMIT 건까지만 후보로 보고,
   * 그중 클릭 지점(screenContext.target)이 있는 가장 이른 이벤트를 고른다. 후보에
   * target 이 하나도 없으면 프레임만 있는 가장 이른 이벤트를 돌려준다. 뷰포트보다 큰
   * 대상은 SDK 가 target 을 버리므로(전형적인 dead click 대상), 시간순만 보면 클릭
   * 지점 없는 빈 프레임이 대표 화면이 된다. 후보 상한은 두 구현이 같은 답을 내도록
   * 계약에 못박은 값이다.
   */
  findScreenContextEvents(query: ScreenContextEventQuery): Promise<TraceEvent[]>;
  getDashboardSummary(projectId: string): Promise<DashboardSummary>;
}

export function assertDeployableTraceStore(store: TraceStore, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production" && store.isDurable !== true) {
    throw new Error("DURABLE_TRACE_STORE_REQUIRED");
  }
}
