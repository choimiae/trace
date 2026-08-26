import type { DashboardSummary, Issue } from "@trace/shared";
import { FrictionTrendChart } from "../components/FrictionTrendChart.js";
import { IssueTable } from "../components/IssueTable.js";
import { IssueTypeChart } from "../components/IssueTypeChart.js";
import { MetricStrip } from "../components/MetricStrip.js";

export function DashboardPage({
  summary,
  issues,
  userEmail,
  onLogout,
  onSelectIssue,
  onShowInstall,
}: {
  summary: DashboardSummary;
  issues: Issue[];
  userEmail: string;
  onLogout: () => void;
  onSelectIssue?: ((issue: Issue) => void) | undefined;
  onShowInstall: () => void;
}) {
  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>문제 인박스</h1>
        </div>
        <div className="header-actions">
          <span className="user-email">{userEmail}</span>
          <button className="secondary-button" type="button" onClick={onShowInstall}>설치 안내</button>
          <button className="secondary-button" type="button" onClick={onLogout}>로그아웃</button>
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
