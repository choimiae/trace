import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Issue } from "@trace/shared";
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

const issue = (overrides: Partial<Issue>): Issue => ({
  issueId: "issue_base",
  projectId: "proj_demo",
  issueType: "rage_click",
  title: "기본 문제",
  summary: "요약",
  affectedSessionsCount: 1,
  affectedUsersCount: 1,
  severityScore: 10,
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-01T00:00:00.000Z",
  trend: "flat",
  relatedUrlPath: "/",
  exampleSessionIds: ["sess_1"],
  status: "new",
  ...overrides,
});

describe("DashboardPage", () => {
  it("인사이트 상태를 글자 라벨과 함께 보여준다", () => {
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        projects={[projects[0]!]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
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
        projects={[projects[0]!]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "프로젝트 설정" })).toBeInTheDocument();
  });

  it("새 프로젝트 버튼 클릭을 전달한다", () => {
    const onCreateProject = vi.fn();
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        projects={[projects[0]!]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onCreateProject={onCreateProject}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));

    expect(onCreateProject).toHaveBeenCalledOnce();
  });

  it("프로젝트가 하나여도 프로젝트 select를 보여준다", () => {
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        projects={[projects[0]!]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
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
        onCreateProject={vi.fn()}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(onSelectProject).toHaveBeenCalledWith("proj_second");
  });

  it("문제 개요를 한눈에 볼 수 있게 보여준다", () => {
    render(
      <DashboardPage
        summary={{
          ...summary,
          issueTypeDistribution: [{ issueType: "rage_click", count: 3 }],
          topTargets: [{ label: "/settings", count: 5 }],
        }}
        issues={[
          issue({
            issueId: "issue_critical",
            title: "/settings 화면에서 반복 클릭이 감지되었습니다",
            summary: "저장 버튼에서 rage click이 반복됩니다.",
            severityScore: 92,
            affectedSessionsCount: 18,
            affectedUsersCount: 12,
            trend: "up",
            relatedUrlPath: "/settings",
            lastSeenAt: "2026-09-01T06:00:00.000Z",
            representativeEvent: {
              eventId: "evt_1",
              sessionId: "sess_1",
              pageId: "page_1",
              timestamp: "2026-09-01T06:00:00.000Z",
              type: "click",
              urlPath: "/settings",
              metadata: {},
              screenContext: {
                titleMasked: "설정",
                viewport: { width: 1440, height: 900 },
                target: {
                  tagName: "button",
                  role: "button",
                  textMaskedOrLimited: "저장",
                  rect: { x: 620, y: 420, width: 96, height: 40 },
                },
                layoutHints: [],
              },
            },
          }),
        ]}
        userEmail="admin@example.com"
        projects={[projects[0]!]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    const overview = screen.getByRole("region", { name: "문제 한눈에 보기" });
    expect(overview).toBeInTheDocument();
    expect(within(overview).getAllByText("/settings 화면에서 반복 클릭이 감지되었습니다")).toHaveLength(1);
    expect(within(overview).getByText("최근 발견 2026-09-01 15:00:00")).toBeInTheDocument();
    expect(within(overview).getAllByText("/settings")).toHaveLength(1);
    expect(within(overview).getByText("분노 클릭")).toBeInTheDocument();
    expect(screen.getByLabelText("화면 맥락 미리보기")).toBeInTheDocument();

    const hero = screen.getByRole("region", { name: "가장 먼저 볼 사용자 막힘" });
    expect(within(hero).getByLabelText("클릭 위치")).toBeInTheDocument();

    const heroHeading = screen.getByText("설정 화면에서 반복 클릭이 감지되었습니다");
    expect(heroHeading).toBeInTheDocument();
    expect(heroHeading).not.toHaveTextContent("/settings");
  });

  it("첫 화면을 숫자보다 화면 맥락 먼저 읽히게 배치한다", () => {
    render(
      <DashboardPage
        summary={summary}
        issues={[
          issue({
            issueId: "issue_critical",
            title: "/settings 화면에서 반복 클릭이 감지되었습니다",
            severityScore: 92,
            relatedUrlPath: "/settings",
          }),
        ]}
        userEmail="admin@example.com"
        projects={[projects[0]!]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    const hero = screen.getByRole("region", { name: "가장 먼저 볼 사용자 막힘" });
    const metrics = screen.getByRole("region", { name: "핵심 지표" });

    expect(hero.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
