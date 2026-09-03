import type { Issue, TraceEvent } from "@trace/shared";
import { elementKey, sameElement } from "./element-identity.js";
import { scoreIssue } from "./severity.js";
import { issueTargetKey } from "./url.js";

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
        elementKey: elementKey(event),
        sessionIds: [event.sessionId],
        timeRange: eventTimeRange([event]),
        severityScore: scoreIssue({ base: 38, affectedSessions: 1 }),
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
      return event.sessionId === current.sessionId && sameElement(event, current) && delta <= 3000;
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
          elementKey: elementKey(current),
          sessionIds,
          timeRange: eventTimeRange(cluster),
          severityScore: scoreIssue({ base: 44, affectedSessions: sessionIds.length, repeatedClicks: cluster.length }),
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
        elementKey: elementKey(event),
        sessionIds: [event.sessionId],
        timeRange: eventTimeRange([event]),
        severityScore: scoreIssue({ base: 35, affectedSessions: 1 }),
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
        elementKey: elementKey(event),
        sessionIds: [event.sessionId],
        timeRange: eventTimeRange([event]),
        severityScore: scoreIssue({ base: 45, affectedSessions: 1, hasError: true }),
        ...(errorSignature(event) === undefined ? {} : { relatedErrorSignature: errorSignature(event)! }),
      }),
    );
}

// 저장은 경로 전체로 한다. basename 으로 줄이면 같은 이름의 다른 경로를 구분할 수 없다.
function errorSignature(event: TraceEvent): string | undefined {
  const location = event.errorSource
    ? `${event.errorSource}${event.errorLine === undefined ? "" : `:${event.errorLine}`}`
    : undefined;
  // 진릿값으로 거른다. undefined 만 보면 null·빈 문자열이 조각으로 세어져
  // " · /assets/cart.js:88" 처럼 구분자만 앞에 남은 서명이 나온다. 오늘은
  // SqliteStore.toEvent 의 compact() 가 null 을 걷어내 닿지 않지만, 그 한 겹에
  // 기대는 대신 여기서 닫는다.
  const parts = [event.errorName, location].filter((part): part is string => Boolean(part));
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function makeIssue(input: {
  projectId: string;
  issueType: Issue["issueType"];
  title: string;
  summary: string;
  relatedUrlPath: string;
  elementKey?: string | undefined;
  sessionIds: string[];
  timeRange: { firstSeenAt: string; lastSeenAt: string };
  severityScore: number;
  relatedErrorSignature?: string;
}): Issue {
  return {
    issueId: `issue_${issueTargetKey({
      urlPath: input.relatedUrlPath,
      elementKey: input.elementKey,
      issueType: input.issueType,
    })}`,
    projectId: input.projectId,
    issueType: input.issueType,
    title: input.title,
    summary: input.summary,
    affectedSessionsCount: input.sessionIds.length,
    affectedUsersCount: input.sessionIds.length,
    severityScore: input.severityScore,
    firstSeenAt: input.timeRange.firstSeenAt,
    lastSeenAt: input.timeRange.lastSeenAt,
    trend: "flat",
    relatedUrlPath: input.relatedUrlPath,
    exampleSessionIds: input.sessionIds.slice(0, 3),
    status: "new",
    // 진릿값 전개를 유지한다. 호출부가 undefined 를 명시적으로 걸러도 이 자리는
    // errorSignature 가 언젠가 빈 문자열을 낼 때 필드가 생기는 것을 막는 마지막
    // 겹이다 — relatedErrorSignature 계약은 min(1) 이라 빈 문자열은 계약 위반이다.
    ...(input.relatedErrorSignature ? { relatedErrorSignature: input.relatedErrorSignature } : {}),
  };
}

// 오류 이벤트에는 요소 정보가 없어 issueTargetKey 가 "page" 로 떨어진다. 그래서 한
// 경로의 모든 오류가 하나의 error_friction 이슈로 접히고, 서명은 그중 하나만 남는다.
// 남길 서명은 "가장 최근 발생 건의 것"이다 — 가장 오래된 것을 붙들면 이미 고친 오류의
// 이름이 대시보드에 영구히 뜨고 그 아래 쌓이는 새 오류는 이름을 얻지 못한다.
//
// 병합된 이슈의 lastSeenAt 은 서명이 없는 발생 건 때문에도 늘어나므로, 서명이 어느
// 시각의 것인지를 따로 기억한다. 그래야 배열 순서에 기대지 않고 언제나 최신을 고른다.
function pickNewestSignatures(issues: Issue[]): Map<string, string> {
  const newest = new Map<string, { signature: string; at: string }>();

  for (const issue of issues) {
    const signature = issue.relatedErrorSignature;
    if (signature === undefined) continue;

    const best = newest.get(issue.issueId);
    if (
      best === undefined ||
      issue.lastSeenAt > best.at ||
      // 밀리초까지 같은 두 서명 사이에 "더 최근"은 없다. 입력 순서로 갈리지 않도록
      // 문자열 순서로 결정한다.
      (issue.lastSeenAt === best.at && signature > best.signature)
    ) {
      newest.set(issue.issueId, { signature, at: issue.lastSeenAt });
    }
  }

  return new Map([...newest].map(([issueId, entry]) => [issueId, entry.signature]));
}

function dedupeIssues(issues: Issue[]): Issue[] {
  const merged = new Map<string, Issue>();
  const newestSignatures = pickNewestSignatures(issues);

  for (const issue of issues) {
    const existing = merged.get(issue.issueId);
    if (!existing) {
      merged.set(issue.issueId, issue);
      continue;
    }

    const exampleSessionIds = unique([...existing.exampleSessionIds, ...issue.exampleSessionIds]).slice(0, 3);
    const affectedSessionsCount = Math.max(
      existing.affectedSessionsCount,
      issue.affectedSessionsCount,
      exampleSessionIds.length,
    );

    merged.set(issue.issueId, {
      ...existing,
      affectedSessionsCount,
      affectedUsersCount: Math.max(existing.affectedUsersCount, issue.affectedUsersCount, affectedSessionsCount),
      severityScore: Math.max(existing.severityScore, issue.severityScore),
      firstSeenAt: minTimestamp(existing.firstSeenAt, issue.firstSeenAt),
      lastSeenAt: maxTimestamp(existing.lastSeenAt, issue.lastSeenAt),
      exampleSessionIds,
    });
  }

  return [...merged.values()].map((issue) => {
    const signature = newestSignatures.get(issue.issueId);
    return signature === undefined ? issue : { ...issue, relatedErrorSignature: signature };
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function eventTimeRange(events: TraceEvent[]): { firstSeenAt: string; lastSeenAt: string } {
  const timestamps = events.map((event) => event.timestamp);
  return {
    firstSeenAt: timestamps.reduce(minTimestamp),
    lastSeenAt: timestamps.reduce(maxTimestamp),
  };
}

function minTimestamp(left: string, right: string): string {
  return left <= right ? left : right;
}

function maxTimestamp(left: string, right: string): string {
  return left >= right ? left : right;
}
