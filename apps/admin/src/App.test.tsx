import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

expect.extend(matchers);

const api = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
  getAuthMe: vi.fn(),
  getDashboardData: vi.fn(),
  logout: vi.fn(),
  getIssueDetail: vi.fn(),
  getSessionTimeline: vi.fn(),
}));

vi.mock("./api", () => ({
  ApiError: api.ApiError,
  getAuthMe: api.getAuthMe,
  getDashboardData: api.getDashboardData,
  logout: api.logout,
  getIssueDetail: api.getIssueDetail,
  getSessionTimeline: api.getSessionTimeline,
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.getDashboardData.mockResolvedValue({
    summary: {
      frictionScore: 82,
      affectedSessionsCount: 312,
      newIssuesCount: 14,
      resolvedOrIgnoredIssuesCount: 6,
      insight: "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다.",
      trend: [{ date: "2026-08-24", score: 82 }],
      issueTypeDistribution: [{ issueType: "rage_click", count: 4 }],
      topTargets: [{ label: "/settings", count: 42 }],
    },
    issues: [{
      issueId: "issue_1",
      projectId: "proj_demo",
      issueType: "rage_click",
      title: "설정 화면에서 반복 클릭",
      summary: "같은 버튼을 반복 클릭했습니다.",
      affectedSessionsCount: 42,
      affectedUsersCount: 42,
      severityScore: 82,
      firstSeenAt: "2026-08-24T00:00:00.000Z",
      lastSeenAt: "2026-08-24T00:00:00.000Z",
      trend: "up",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new",
    }],
  });
});

afterEach(cleanup);

describe("App auth state", () => {
  it("renders a Google login screen on auth/me 401", async () => {
    api.getAuthMe.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));
    render(<App />);
    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
  });

  it("renders an access denied screen on auth/me 403", async () => {
    api.getAuthMe.mockRejectedValue(new api.ApiError(403, "project_access_denied"));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "접근 권한이 없습니다." })).toBeInTheDocument();
  });

  it("retries after a network failure", async () => {
    api.getAuthMe
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({
        user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
        projects: [{ projectId: "proj_demo", role: "owner" }],
        csrfToken: "csrf_1",
      });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "연결할 수 없습니다." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();
  });

  it("renders dashboard after auth/me succeeds", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    render(<App />);
    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();
    expect(await screen.findByText("설정 화면에서 반복 클릭")).toBeInTheDocument();
  });

  it("posts logout with the CSRF token", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    expect(api.logout).toHaveBeenCalledWith("csrf_1");
  });
});
