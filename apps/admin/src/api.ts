import type { DashboardSummary, Issue, ReplayConfig, SessionTimelineEvent } from "@trace/shared";
import { API_BASE_URL } from "./config.js";

export type ProjectRole = "owner" | "admin" | "viewer";

export interface ProjectSettingsResponse {
  projectId: string;
  name: string;
  allowedDomains: string[];
  replay: ReplayConfig;
  role: ProjectRole;
}

export interface ProjectMemberResponse {
  adminUserId: string;
  email: string;
  name?: string;
  role: ProjectRole;
  createdAt: string;
}

export interface AddProjectMemberInput {
  email: string;
  role: Extract<ProjectRole, "admin" | "viewer">;
}

export interface AuthMeResponse {
  user: { adminUserId: string; email: string; name?: string; pictureUrl?: string };
  projects: Array<{ projectId: string; role: ProjectRole }>;
  csrfToken: string;
  auth?: LoginOptionsResponse;
}

export interface LoginOptionsResponse {
  googleLogin: boolean;
  localLogin: boolean;
}

export interface SessionResponse {
  sessionId: string;
  startedAt: string;
  lastSeenAt: string;
  eventCount: number;
  /** 리플레이 기록이 있는 세션인지. 재생 버튼을 띄울지 가른다. */
  hasRecording: boolean;
}

export interface RecordingChunkSummary {
  seq: number;
  eventCount: number;
  /** gzip 상태의 크기다. 푼 크기가 아니다. */
  bytes: number;
  startedAt: string;
  receivedAt: string;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const credentialedFetch = (path: string, init: RequestInit = {}) =>
  fetch(`${API_BASE_URL}${path}`, { ...init, credentials: "include" });

export async function getAuthMe(): Promise<AuthMeResponse> {
  return getJson<AuthMeResponse>("/auth/me");
}

export async function getLoginOptions(): Promise<LoginOptionsResponse> {
  return getJson<LoginOptionsResponse>("/auth/login-options");
}

export async function logout(csrfToken: string): Promise<void> {
  await ensureSuccess("/auth/logout", {
    method: "POST",
    headers: { "x-trace-csrf": csrfToken },
  });
}

export async function createProject(
  input: { name: string; allowedDomains: string[] },
  csrfToken: string,
): Promise<{ projectId: string }> {
  const response = await ensureSuccess("/admin/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json", "x-trace-csrf": csrfToken },
    body: JSON.stringify(input),
  });

  return response.json() as Promise<{ projectId: string }>;
}

export async function getProjectSettings(projectId: string): Promise<ProjectSettingsResponse> {
  return getJson<ProjectSettingsResponse>(`/admin/api/projects/${projectId}`);
}

export async function getProjectMembers(projectId: string): Promise<ProjectMemberResponse[]> {
  return getJson<ProjectMemberResponse[]>(`/admin/api/projects/${projectId}/members`);
}

export interface ProjectMemberCandidateResponse {
  adminUserId: string;
  email: string;
  name?: string;
  membership?: { role: ProjectRole };
}

export async function searchProjectMemberCandidates(
  projectId: string,
  query: string,
): Promise<ProjectMemberCandidateResponse[]> {
  // query 는 사용자 자유 입력이다. 인코딩하지 않으면 &, #, +, 공백이
  // 서버에 잘못 전달된다.
  return getJson<ProjectMemberCandidateResponse[]>(
    `/admin/api/projects/${projectId}/member-candidates?query=${encodeURIComponent(query)}`,
  );
}

export interface ProjectAuditLogActorResponse {
  adminUserId: string;
  email?: string;
  name?: string;
}

export interface ProjectAuditLogEntryResponse {
  auditLogId: string;
  action: string;
  createdAt: string;
  actor?: ProjectAuditLogActorResponse;
  metadata: Record<string, unknown>;
}

export interface ProjectAuditLogPageResponse {
  entries: ProjectAuditLogEntryResponse[];
  nextCursor?: string;
}

export async function getProjectAuditLogs(
  projectId: string,
  cursor?: string,
): Promise<ProjectAuditLogPageResponse> {
  const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  return getJson<ProjectAuditLogPageResponse>(
    `/admin/api/projects/${projectId}/audit-logs${query}`,
  );
}

export async function addProjectMember(
  projectId: string,
  input: AddProjectMemberInput,
  csrfToken: string,
): Promise<ProjectMemberResponse> {
  const response = await ensureSuccess(`/admin/api/projects/${projectId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-trace-csrf": csrfToken },
    body: JSON.stringify(input),
  });

  return response.json() as Promise<ProjectMemberResponse>;
}

export async function updateProjectMemberRole(
  projectId: string,
  adminUserId: string,
  input: { role: ProjectRole },
  csrfToken: string,
): Promise<ProjectMemberResponse> {
  const response = await ensureSuccess(`/admin/api/projects/${projectId}/members/${adminUserId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-trace-csrf": csrfToken },
    body: JSON.stringify(input),
  });

  return response.json() as Promise<ProjectMemberResponse>;
}

export async function removeProjectMember(
  projectId: string,
  adminUserId: string,
  csrfToken: string,
): Promise<void> {
  await ensureSuccess(`/admin/api/projects/${projectId}/members/${adminUserId}`, {
    method: "DELETE",
    headers: { "x-trace-csrf": csrfToken },
  });
}

export async function updateProjectSettings(
  projectId: string,
  input: { name: string; allowedDomains: string[]; replay: ReplayConfig },
  csrfToken: string,
): Promise<ProjectSettingsResponse> {
  const response = await ensureSuccess(`/admin/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-trace-csrf": csrfToken },
    body: JSON.stringify(input),
  });

  return response.json() as Promise<ProjectSettingsResponse>;
}

export async function getDashboardData(projectId: string): Promise<{ summary: DashboardSummary; issues: Issue[] }> {
  const [summary, issues] = await Promise.all([
    getJson<DashboardSummary>(`/admin/api/projects/${projectId}/summary`),
    getJson<Issue[]>(`/admin/api/projects/${projectId}/issues`),
  ]);

  return { summary, issues };
}

export async function getIssueDetail(projectId: string, issueId: string): Promise<Issue> {
  return getJson<Issue>(`/admin/api/issues/${issueId}?projectId=${projectId}`);
}

export async function getSessionTimeline(projectId: string, sessionId: string): Promise<SessionTimelineEvent[]> {
  return getJson<SessionTimelineEvent[]>(`/admin/api/sessions/${sessionId}/timeline?projectId=${projectId}`);
}

export async function getSessions(projectId: string): Promise<SessionResponse[]> {
  const body = await getJson<{ sessions: SessionResponse[] }>(
    `/admin/api/projects/${projectId}/sessions`,
  );
  return body.sessions;
}

export interface PageStatsResponse {
  urlPath: string;
  views: number;
  averageDwellMs?: number;
  exitRate: number;
  scrollReach: Array<{ depth: number; ratio: number }>;
}

export async function getPageStats(projectId: string): Promise<PageStatsResponse[]> {
  const body = await getJson<{ pages: PageStatsResponse[] }>(
    `/admin/api/projects/${projectId}/page-stats`,
  );
  return body.pages;
}

export async function getRecordingManifest(
  projectId: string,
  sessionId: string,
): Promise<RecordingChunkSummary[]> {
  const body = await getJson<{ chunks: RecordingChunkSummary[] }>(
    `/admin/api/sessions/${sessionId}/recording?projectId=${projectId}`,
  );
  return body.chunks;
}

// 응답은 Content-Encoding: gzip 이다. 브라우저가 투명하게 풀어 주므로
// 여기서 압축을 다룰 일이 없다 - 우리가 풀면 두 번 푸는 것이다.
export async function getRecordingChunk(
  projectId: string,
  sessionId: string,
  seq: number,
): Promise<unknown> {
  return getJson<unknown>(
    `/admin/api/sessions/${sessionId}/recording/chunks/${seq}?projectId=${projectId}`,
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await ensureSuccess(path);
  return response.json() as Promise<T>;
}

async function ensureSuccess(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await credentialedFetch(path, init);
  if (response.ok) return response;

  const body = await response.json().catch(() => undefined);
  const error = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : response.statusText;
  throw new ApiError(response.status, error);
}
