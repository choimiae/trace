import type { DashboardSummary, Issue, SessionTimelineEvent } from "@trace/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const PROJECT_ID = import.meta.env.VITE_PROJECT_ID ?? "proj_demo";

export async function getDashboardData(): Promise<{ summary: DashboardSummary; issues: Issue[] }> {
  const [summary, issues] = await Promise.all([
    fetch(`${API_BASE}/api/projects/${PROJECT_ID}/summary`).then((response) => response.json() as Promise<DashboardSummary>),
    fetch(`${API_BASE}/api/projects/${PROJECT_ID}/issues`).then((response) => response.json() as Promise<Issue[]>),
  ]);

  return { summary, issues };
}

export async function getIssueDetail(issueId: string): Promise<Issue> {
  return fetch(`${API_BASE}/api/issues/${issueId}`).then((response) => response.json() as Promise<Issue>);
}

export async function getSessionTimeline(projectId: string, sessionId: string): Promise<SessionTimelineEvent[]> {
  return fetch(`${API_BASE}/api/sessions/${sessionId}/timeline?projectId=${projectId}`).then(
    (response) => response.json() as Promise<SessionTimelineEvent[]>,
  );
}
