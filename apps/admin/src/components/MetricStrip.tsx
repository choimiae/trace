import type { DashboardSummary } from "@trace/shared";

export function MetricStrip({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="metric-strip" aria-label="핵심 지표">
      <div>
        <span>막힘 점수</span>
        <strong>{summary.frictionScore}</strong>
      </div>
      <div>
        <span>영향 세션</span>
        <strong>{summary.affectedSessionsCount}</strong>
      </div>
      <div>
        <span>신규 이슈</span>
        <strong>{summary.newIssuesCount}</strong>
      </div>
      <div>
        <span>처리됨</span>
        <strong>{summary.resolvedOrIgnoredIssuesCount}</strong>
      </div>
    </section>
  );
}
