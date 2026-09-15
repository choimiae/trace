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

export interface SessionRecordingChunk {
  sessionId: string;
  projectId: string;
  seq: number;
  /**
   * 기록이 시작된 시각. **브라우저 시계가 적어 보낸 값이다** — 봉투 검증은
   * "날짜 문자열이다" 까지만 본다. 재생 타임라인에만 쓰고 보존 판정에는 쓰지
   * 않는다.
   */
  startedAt: string;
  /**
   * 서버가 청크를 받은 시각. 보존 스윕이 보는 유일한 시각이다.
   *
   * 라우트가 자기 시계로 채운다 — 클라이언트가 보낸 값을 여기에 넣으면 안 된다.
   * startedAt 으로 판정하던 시절에는 시계가 미래로 어긋난 기기의 기록이 7일
   * 창을 영원히 살아남고, 과거로 어긋난 기기의 기록은 저장되자마자 같은 요청
   * 안의 스윕에 지워져 202 를 받고도 아무것도 남지 않았다.
   */
  receivedAt: string;
  eventCount: number;
  /** gzip 된 봉투 그대로. 서버는 검증을 위해 풀어 볼 뿐 풀어서 저장하지 않는다. */
  bytes: Uint8Array;
}

/** 한 세션의 기록을 요약한 값. 목록 화면이 쓴다. */
export interface RecordedSessionSummary {
  sessionId: string;
  /** 가장 이른 청크의 `startedAt`. 브라우저 시계가 적은 값이라 표시용이다. */
  startedAt: string;
  /** 가장 늦은 청크의 `receivedAt`. 목록 정렬이 보는 값이다. */
  lastReceivedAt: string;
  chunkCount: number;
  eventCount: number;
  /** gzip 상태의 바이트 합. 푼 크기가 아니다. */
  bytes: number;
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
  /** 같은 (sessionId, seq) 가 이미 있으면 무시한다 — 재전송이 구간을 중복시키지 않게. */
  saveSessionRecordingChunk(chunk: SessionRecordingChunk): Promise<void>;
  /** seq 오름차순. 재생은 이 순서로 이어 붙인다. */
  listSessionRecordingChunks(projectId: string, sessionId: string): Promise<SessionRecordingChunk[]>;
  /** `lastReceivedAt` 내림차순. 최근 기록이 먼저다. */
  listRecordedSessions(projectId: string, limit: number): Promise<RecordedSessionSummary[]>;
  /** `receivedAt` 이 cutoff 이전인 청크를 지운다. startedAt 은 보지 않는다. */
  deleteSessionRecordingsBefore(cutoff: string): Promise<number>;
}

export function assertDeployableTraceStore(store: TraceStore, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production" && store.isDurable !== true) {
    throw new Error("DURABLE_TRACE_STORE_REQUIRED");
  }
}
