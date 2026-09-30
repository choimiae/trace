import type { EventBatch, ReplayConfig, TraceEvent } from "@trace/shared";

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

/** 한 세션을 요약한 값. 세션 목록 화면이 쓴다. 기록이 없는 세션도 들어간다. */
export interface SessionSummary {
  sessionId: string;
  /** 가장 이른 이벤트의 timestamp. 브라우저 시계가 적은 값이라 표시용이다. */
  startedAt: string;
  /** 가장 늦은 이벤트의 timestamp. */
  lastSeenAt: string;
  eventCount: number;
  /** 이 세션에 리플레이 기록이 올라와 있는지. 재생 버튼을 띄울지 가른다. */
  hasRecording: boolean;
}

/** 페이지 기준 통계. 체류는 저장하지 않고 조회 시점에 계산한다. */
export interface PageStats {
  urlPath: string;
  views: number;
  /**
   * `page_view` 와 그 세션의 다음 `page_leave` 차이의 평균(ms).
   * 짝이 있는 방문이 하나도 없으면 `undefined` 다 — 0 과 구분해야 한다.
   */
  averageDwellMs: number | undefined;
  /** 그 페이지가 세션의 마지막 `page_view` 였던 비율. 0~1. */
  exitRate: number;
  /** 25·50·75·100 각각에 도달한 방문의 비율. 0~1. */
  scrollReach: Array<{ depth: number; ratio: number }>;
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
  getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]>;
  /** 같은 (sessionId, seq) 가 이미 있으면 무시한다 — 재전송이 구간을 중복시키지 않게. */
  saveSessionRecordingChunk(chunk: SessionRecordingChunk): Promise<void>;
  /** seq 오름차순. 재생은 이 순서로 이어 붙인다. */
  listSessionRecordingChunks(projectId: string, sessionId: string): Promise<SessionRecordingChunk[]>;
  /**
   * seq 하나만 가져온다. 청크 다운로드 라우트가 쓴다 - `listSessionRecordingChunks`
   * 로 세션 전체를 읽고 `.find()` 로 고르면 재생 한 번에 세션의 모든 BLOB 을
   * SELECT·복사하게 된다(SDK 가 10초마다 flush 하므로 30분 세션이면 청크 약 180개).
   * `session_recordings_project_session (project_id, session_id, seq)` 인덱스가
   * 이 조회를 덮는다.
   */
  getSessionRecordingChunk(projectId: string, sessionId: string, seq: number): Promise<SessionRecordingChunk | undefined>;
  /** `startedAt` 내림차순. 최근 세션이 먼저다. 기록 없는 세션도 포함한다. */
  listSessions(projectId: string, limit: number): Promise<SessionSummary[]>;
  /** `views` 내림차순. 많이 본 페이지가 먼저다. */
  listPageStats(projectId: string, limit: number): Promise<PageStats[]>;
  /** `receivedAt` 이 cutoff 이전인 청크를 지운다. startedAt 은 보지 않는다. */
  deleteSessionRecordingsBefore(cutoff: string): Promise<number>;
}

export function assertDeployableTraceStore(store: TraceStore, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production" && store.isDurable !== true) {
    throw new Error("DURABLE_TRACE_STORE_REQUIRED");
  }
}
