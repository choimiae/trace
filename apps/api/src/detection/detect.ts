import type { Issue, TraceEvent } from "@trace/shared";
import { scoreIssue } from "./severity";
import { issueTargetKey } from "./url";

interface DetectInput {
  projectId: string;
  events: TraceEvent[];
  now: string;
}

export function detectIssues(input: DetectInput): Issue[] {
  const events = [...input.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const issues: Issue[] = [];

  issues.push(...detectDeadClicks(input.projectId, events, input.now));
  issues.push(...detectRageClicks(input.projectId, events, input.now));
  issues.push(...detectLongPauses(input.projectId, events, input.now));
  issues.push(...detectErrorFriction(input.projectId, events, input.now));

  return dedupeIssues(issues).sort((a, b) => b.severityScore - a.severityScore);
}

function detectDeadClicks(projectId: string, events: TraceEvent[], now: string): Issue[] {
  return events
    .filter((event) => event.type === "click" && event.elementSelectorHash)
    .filter((event) => {
      const clickTime = Date.parse(event.timestamp);
      const response = events.find((candidate) => {
        const delta = Date.parse(candidate.timestamp) - clickTime;
        if (candidate.sessionId !== event.sessionId || delta <= 0 || delta > 2000) return false;
        if (candidate.type === "page_view" || candidate.type === "custom_event") return true;
        if (candidate.type === "js_error" || candidate.type === "api_error") return true;
        return candidate.urlPath !== event.urlPath;
      });

      return !response;
    })
    .map((event) =>
      makeIssue({
        projectId,
        issueType: "dead_click_cluster",
        title: `${event.urlPath} 화면에서 반응 없는 클릭이 감지되었습니다`,
        summary: "클릭 후 2초 안에 화면 변화, 이벤트, 오류, URL 변경이 감지되지 않았습니다.",
        relatedUrlPath: event.urlPath,
        selectorHash: event.elementSelectorHash,
        sessionIds: [event.sessionId],
        severityScore: scoreIssue({ base: 38, affectedSessions: 1 }),
        now,
      }),
    );
}

function detectRageClicks(projectId: string, events: TraceEvent[], now: string): Issue[] {
  const clicks = events.filter((event) => event.type === "click" && event.elementSelectorHash);
  const issues: Issue[] = [];

  for (let index = 0; index < clicks.length; index += 1) {
    const current = clicks[index];
    if (!current) continue;

    const cluster = clicks.filter((event) => {
      const delta = Math.abs(Date.parse(event.timestamp) - Date.parse(current.timestamp));
      return (
        event.sessionId === current.sessionId &&
        event.elementSelectorHash === current.elementSelectorHash &&
        delta <= 3000
      );
    });

    if (cluster.length >= 3) {
      const sessionIds = unique(cluster.map((event) => event.sessionId));
      issues.push(
        makeIssue({
          projectId,
          issueType: "rage_click",
          title: `${current.urlPath} 화면에서 반복 클릭이 감지되었습니다`,
          summary: `${cluster.length}회 클릭이 3초 안에 같은 요소에서 발생했습니다.`,
          relatedUrlPath: current.urlPath,
          selectorHash: current.elementSelectorHash,
          sessionIds,
          severityScore: scoreIssue({ base: 44, affectedSessions: sessionIds.length, repeatedClicks: cluster.length }),
          now,
        }),
      );
    }
  }

  return issues;
}

function detectLongPauses(projectId: string, events: TraceEvent[], now: string): Issue[] {
  return events
    .filter((event) => event.type === "idle" && Number(event.metadata.durationMs ?? 0) >= 15000)
    .map((event) =>
      makeIssue({
        projectId,
        issueType: "long_pause",
        title: `${event.urlPath} 화면에서 긴 정지가 감지되었습니다`,
        summary: `${Math.round(Number(event.metadata.durationMs) / 1000)}초 동안 후속 행동이 없었습니다.`,
        relatedUrlPath: event.urlPath,
        selectorHash: event.elementSelectorHash,
        sessionIds: [event.sessionId],
        severityScore: scoreIssue({ base: 35, affectedSessions: 1 }),
        now,
      }),
    );
}

function detectErrorFriction(projectId: string, events: TraceEvent[], now: string): Issue[] {
  return events
    .filter((event) => event.type === "js_error" || event.type === "api_error")
    .map((event) =>
      makeIssue({
        projectId,
        issueType: "error_friction",
        title: `${event.urlPath} 화면에서 오류 기반 막힘이 감지되었습니다`,
        summary: `사용자 행동 흐름 중 ${event.type} 이벤트가 발생했습니다.`,
        relatedUrlPath: event.urlPath,
        selectorHash: event.elementSelectorHash,
        sessionIds: [event.sessionId],
        severityScore: scoreIssue({ base: 45, affectedSessions: 1, hasError: true }),
        now,
      }),
    );
}

function makeIssue(input: {
  projectId: string;
  issueType: Issue["issueType"];
  title: string;
  summary: string;
  relatedUrlPath: string;
  selectorHash?: string | undefined;
  sessionIds: string[];
  severityScore: number;
  now: string;
}): Issue {
  return {
    issueId: `issue_${issueTargetKey({
      urlPath: input.relatedUrlPath,
      selectorHash: input.selectorHash,
      issueType: input.issueType,
    })}`,
    projectId: input.projectId,
    issueType: input.issueType,
    title: input.title,
    summary: input.summary,
    affectedSessionsCount: input.sessionIds.length,
    affectedUsersCount: input.sessionIds.length,
    severityScore: input.severityScore,
    firstSeenAt: input.now,
    lastSeenAt: input.now,
    trend: "flat",
    relatedUrlPath: input.relatedUrlPath,
    exampleSessionIds: input.sessionIds.slice(0, 3),
    status: "new",
  };
}

function dedupeIssues(issues: Issue[]): Issue[] {
  return [...new Map(issues.map((issue) => [issue.issueId, issue])).values()];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
