import { type DashboardSummary, type Issue, issueTypeLabel } from "@trace/shared";

export function buildDashboardSummary(issues: Issue[], totalEventsCount: number): DashboardSummary {
  const activeIssues = issues.filter((issue) => issue.status === "new" || issue.status === "reviewing");
  const frictionScore = activeIssues.length === 0 ? 0 : Math.max(...activeIssues.map((issue) => issue.severityScore));

  return {
    totalEventsCount,
    frictionScore,
    affectedSessionsCount: activeIssues.reduce((sum, issue) => sum + issue.affectedSessionsCount, 0),
    newIssuesCount: issues.filter((issue) => issue.status === "new").length,
    resolvedOrIgnoredIssuesCount: issues.filter((issue) => issue.status === "resolved" || issue.status === "ignored")
      .length,
    insight: activeIssues[0]
      ? `${activeIssues[0].relatedUrlPath ?? "알 수 없는 화면"}에서 ${issueTypeLabel(activeIssues[0].issueType)} 문제가 가장 크게 나타났습니다.`
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
