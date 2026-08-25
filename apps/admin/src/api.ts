import type { DashboardSummary, Issue, SessionTimelineEvent } from "@trace/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const DEFAULT_PROJECT_ID = import.meta.env.VITE_PROJECT_ID;

export interface AuthMeResponse {
  user: { adminUserId: string; email: string; name?: string; pictureUrl?: string };
  projects: Array<{ projectId: string; role: "owner" | "admin" | "viewer" }>;
  csrfToken: string;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const credentialedFetch = (path: string, init: RequestInit = {}) =>
  fetch(`${API_BASE}${path}`, { ...init, credentials: "include" });

export async function getAuthMe(): Promise<AuthMeResponse> {
  return getJson<AuthMeResponse>("/auth/me");
}

export async function logout(csrfToken: string): Promise<void> {
  await ensureSuccess("/auth/logout", {
    method: "POST",
    headers: { "x-trace-csrf": csrfToken },
  });
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
