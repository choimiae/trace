import type { DashboardSummary, Issue } from "@trace/shared";
import { lazy, Suspense } from "react";
import { IssueDashboardOverview } from "../components/IssueDashboardOverview.js";
import { IssueTable } from "../components/IssueTable.js";
import { MetricStrip } from "../components/MetricStrip.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Chip } from "../ui/Chip.js";

const FrictionTrendChart = lazy(() =>
  import("../components/charts/FrictionTrendChart.js").then((module) => ({
    default: module.FrictionTrendChart,
  })),
);

const IssueTypeChart = lazy(() =>
  import("../components/charts/IssueTypeChart.js").then((module) => ({
    default: module.IssueTypeChart,
  })),
);

export type ProjectOption = {
  projectId: string;
  role: "owner" | "admin" | "viewer";
};

export function DashboardPage({
  summary,
  issues,
  userEmail,
  projects = [],
  projectId = "",
  onSelectProject = () => {},
  settingsError,
  onLogout,
  onSelectIssue,
  onCreateProject,
  onShowInstall,
  onShowSettings,
}: {
  summary: DashboardSummary;
  issues: Issue[];
  userEmail: string;
  projects: ProjectOption[];
  projectId: string;
  onSelectProject: (projectId: string) => void;
  settingsError?: string | undefined;
  onLogout: () => void;
  onSelectIssue?: ((issue: Issue) => void) | undefined;
  onCreateProject: () => void;
  onShowInstall: () => void;
  onShowSettings: () => void;
}) {
  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>문제 인박스</h1>
        </div>
        <div className="header-actions">
          <label className="project-switcher">
            <span>프로젝트</span>
            <select value={projectId} onChange={(event) => onSelectProject(event.currentTarget.value)}>
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectId}
                </option>
              ))}
            </select>
          </label>
          <span className="user-email">{userEmail}</span>
          <Button onClick={onCreateProject}>새 프로젝트</Button>
          <Button onClick={onShowSettings}>프로젝트 설정</Button>
          <Button onClick={onShowInstall}>설치 안내</Button>
          <Button onClick={onLogout}>로그아웃</Button>
        </div>
      </header>
      {settingsError ? (
        <p className="dashboard-notice" role="alert">
          {settingsError}
        </p>
      ) : null}
      {/* 화면 먼저, 숫자는 보조. 대표 막힘 문장과 화면 맥락이 지표보다 앞에 온다. */}
      <IssueDashboardOverview summary={summary} issues={issues} onSelectIssue={onSelectIssue} />
      <MetricStrip summary={summary} />
      <section className="insight">
        <Chip status="crit" label="심각" />
        <span>{summary.insight}</span>
      </section>
      <section className="chart-grid" aria-label="막힘 분석 차트">
        <Suspense
          fallback={
            <>
              <Card as="section" className="chart-panel" />
              <Card as="section" className="chart-panel" />
            </>
          }
        >
          <FrictionTrendChart data={summary.trend} />
          <IssueTypeChart data={summary.issueTypeDistribution} />
        </Suspense>
      </section>
      <IssueTable issues={issues} onSelectIssue={onSelectIssue} />
    </main>
  );
}
