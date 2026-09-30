import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage.js";

expect.extend(matchers);
afterEach(cleanup);

const projects = [
  { projectId: "proj_demo" },
  { projectId: "proj_second" },
];

describe("DashboardPage", () => {
  it("프로젝트 설정 버튼을 보여준다", () => {
    render(
      <DashboardPage
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

  it("세션 카드를 그린다", () => {
    render(
      <DashboardPage
        userEmail="admin@example.com"
        projects={[projects[0]!]}
        projectId="proj_demo"
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
        sessions={[
          {
            sessionId: "sess_abc",
            startedAt: "2026-09-15T00:00:00.000Z",
            lastSeenAt: "2026-09-15T00:05:00.000Z",
            eventCount: 12,
            hasRecording: false,
          },
        ]}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "세션" })).toBeInTheDocument();
    expect(screen.getByText("sess_abc")).toBeInTheDocument();
  });
});
