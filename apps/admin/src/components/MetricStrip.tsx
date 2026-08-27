import type { DashboardSummary } from "@trace/shared";
import { Card } from "../ui/Card.js";

export function MetricStrip({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="metric-strip" aria-label="핵심 지표">
      <Card>
        <span>막힘 점수</span>
        <strong>{summary.frictionScore}</strong>
      </Card>
      <Card>
        <span>영향 세션</span>
        <strong>{summary.affectedSessionsCount}</strong>
      </Card>
      <Card>
        <span>신규 이슈</span>
        <strong>{summary.newIssuesCount}</strong>
      </Card>
      <Card>
        <span>처리됨</span>
        <strong>{summary.resolvedOrIgnoredIssuesCount}</strong>
      </Card>
    </section>
  );
}
