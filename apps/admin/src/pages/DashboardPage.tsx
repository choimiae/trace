import type { DashboardSummary, Issue } from "@trace/shared";
import { FrictionTrendChart } from "../components/FrictionTrendChart.js";
import { IssueTable } from "../components/IssueTable.js";
import { IssueTypeChart } from "../components/IssueTypeChart.js";
import { MetricStrip } from "../components/MetricStrip.js";

export function DashboardPage({
  summary,
  issues,
  onSelectIssue,
}: {
  summary: DashboardSummary;
  issues: Issue[];
  onSelectIssue?: ((issue: Issue) => void) | undefined;
}) {
  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>문제 인박스</h1>
        </div>
      </header>
      <MetricStrip summary={summary} />
      <section className="insight">{summary.insight}</section>
      <section className="chart-grid" aria-label="막힘 분석 차트">
        <FrictionTrendChart data={summary.trend} />
        <IssueTypeChart data={summary.issueTypeDistribution} />
      </section>
      <IssueTable issues={issues} onSelectIssue={onSelectIssue} />
    </main>
  );
}
