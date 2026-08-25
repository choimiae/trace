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

export interface StoredSession {
  sessionId: string;
  projectId: string;
  anonymousUserId: string;
  startedAt: string;
  endedAt?: string;
}

export interface TraceStore {
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  getProject(projectId: string): Promise<ProjectRecord | undefined>;
  saveBatch(batch: EventBatch): Promise<void>;
  listEvents(projectId: string): Promise<TraceEvent[]>;
  upsertIssues(projectId: string, issues: Issue[]): Promise<void>;
  listIssues(projectId: string): Promise<Issue[]>;
  getIssue(issueId: string): Promise<Issue | undefined>;
  getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]>;
  getDashboardSummary(projectId: string): Promise<DashboardSummary>;
}
