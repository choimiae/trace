import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage.js";

expect.extend(matchers);
afterEach(cleanup);

const summary = {
  frictionScore: 82,
  affectedSessionsCount: 312,
  newIssuesCount: 14,
  resolvedOrIgnoredIssuesCount: 6,
  totalEventsCount: 128,
  insight: "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다.",
  trend: [],
  issueTypeDistribution: [],
  topTargets: [],
};

const projects = [
  { projectId: "proj_demo", role: "owner" as const },
  { projectId: "proj_second", role: "viewer" as const },
];

describe("DashboardPage", () => {
  it("인사이트 상태를 글자 라벨과 함께 보여준다", () => {
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        projects={[projects[0]]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );
    expect(screen.getByText("심각")).toBeInTheDocument();
    expect(screen.getByText(summary.insight)).toBeInTheDocument();
  });

  it("프로젝트 설정 버튼을 보여준다", () => {
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        projects={[projects[0]]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "프로젝트 설정" })).toBeInTheDocument();
  });

  it("프로젝트가 하나여도 프로젝트 select를 보여준다", () => {
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        projects={[projects[0]]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    const select = screen.getByLabelText("프로젝트");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("proj_demo");
    expect(screen.getByRole("option", { name: "proj_demo" })).toBeInTheDocument();
  });

  it("프로젝트 선택이 바뀌면 선택 콜백을 호출한다", () => {
    const onSelectProject = vi.fn();
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        projects={projects}
        projectId="proj_demo"
        onSelectProject={onSelectProject}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(onSelectProject).toHaveBeenCalledWith("proj_second");
  });
});
