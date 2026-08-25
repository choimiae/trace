import type { DashboardSummary, EventBatch, Issue, TraceEvent } from "@trace/shared";
import { nanoid } from "nanoid";
import type { CreateProjectInput, ProjectRecord, TraceStore } from "./types.js";

export class MemoryStore implements TraceStore {
  private projects = new Map<string, ProjectRecord>();
  private events = new Map<string, TraceEvent[]>();
  private issues = new Map<string, Issue>();

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
    const issues = await this.listIssues(projectId);
    const activeIssues = issues.filter((issue) => issue.status === "new" || issue.status === "reviewing");
    const frictionScore = activeIssues.length === 0 ? 0 : Math.max(...activeIssues.map((issue) => issue.severityScore));

    return {
      frictionScore,
      affectedSessionsCount: activeIssues.reduce((sum, issue) => sum + issue.affectedSessionsCount, 0),
      newIssuesCount: issues.filter((issue) => issue.status === "new").length,
      resolvedOrIgnoredIssuesCount: issues.filter((issue) => issue.status === "resolved" || issue.status === "ignored")
        .length,
      insight: activeIssues[0]
        ? `${activeIssues[0].relatedUrlPath ?? "알 수 없는 화면"}에서 ${activeIssues[0].issueType} 문제가 가장 크게 나타났습니다.`
        : "아직 감지된 사용자 막힘이 없습니다.",
      trend: [{ date: new Date().toISOString().slice(0, 10), score: frictionScore }],
      issueTypeDistribution: Object.entries(
        activeIssues.reduce<Record<string, number>>((acc, issue) => {
          acc[issue.issueType] = (acc[issue.issueType] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([issueType, count]) => ({ issueType: issueType as never, count })),
      topTargets: activeIssues.slice(0, 5).map((issue) => ({
        label: issue.relatedUrlPath ?? issue.title,
        count: issue.affectedSessionsCount,
      })),
    };
  }
}
