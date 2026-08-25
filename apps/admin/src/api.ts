import type { DashboardSummary, Issue, SessionTimelineEvent } from "@trace/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const PROJECT_ID = import.meta.env.VITE_PROJECT_ID ?? "proj_demo";
const ADMIN_TOKEN = import.meta.env.VITE_TRACE_ADMIN_TOKEN;

const adminHeaders = ADMIN_TOKEN ? { authorization: `Bearer ${ADMIN_TOKEN}` } : undefined;
const adminFetchInit = adminHeaders ? { headers: adminHeaders } : undefined;

export async function getDashboardData(): Promise<{ summary: DashboardSummary; issues: Issue[] }> {
  const [summary, issues] = await Promise.all([
    fetch(`${API_BASE}/api/projects/${PROJECT_ID}/summary`, adminFetchInit).then(
      (response) => response.json() as Promise<DashboardSummary>,
    ),
    fetch(`${API_BASE}/api/projects/${PROJECT_ID}/issues`, adminFetchInit).then(
      (response) => response.json() as Promise<Issue[]>,
    ),
  ]);

  return { summary, issues };
}

export async function getIssueDetail(issueId: string): Promise<Issue> {
  return fetch(`${API_BASE}/api/issues/${issueId}?projectId=${PROJECT_ID}`, adminFetchInit).then(
    (response) => response.json() as Promise<Issue>,
  );
}

export async function getSessionTimeline(projectId: string, sessionId: string): Promise<SessionTimelineEvent[]> {
  return fetch(`${API_BASE}/api/sessions/${sessionId}/timeline?projectId=${projectId}`, adminFetchInit).then(
    (response) => response.json() as Promise<SessionTimelineEvent[]>,
  );
}
