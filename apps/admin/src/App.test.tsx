import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  createProject: vi.fn(),
  getDashboardData: vi.fn(),
  getProjectSettings: vi.fn(),
  logout: vi.fn(),
  updateProjectSettings: vi.fn(),
  getIssueDetail: vi.fn(),
  getSessionTimeline: vi.fn(),
}));

vi.mock("./api", () => ({
  ApiError: api.ApiError,
  getAuthMe: api.getAuthMe,
  createProject: api.createProject,
  getDashboardData: api.getDashboardData,
  getProjectSettings: api.getProjectSettings,
  logout: api.logout,
  updateProjectSettings: api.updateProjectSettings,
  getIssueDetail: api.getIssueDetail,
  getSessionTimeline: api.getSessionTimeline,
}));

const baseSummary = {
  frictionScore: 82,
  affectedSessionsCount: 312,
  newIssuesCount: 14,
  resolvedOrIgnoredIssuesCount: 6,
  totalEventsCount: 128,
  insight: "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다.",
  trend: [{ date: "2026-08-24", score: 82 }],
  issueTypeDistribution: [{ issueType: "rage_click" as const, count: 4 }],
  topTargets: [{ label: "/settings", count: 42 }],
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getDashboardData.mockResolvedValue({
    summary: baseSummary,
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
  api.getProjectSettings.mockResolvedValue({
    projectId: "proj_demo",
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
    role: "owner",
  });
  api.updateProjectSettings.mockResolvedValue({
    projectId: "proj_demo",
    name: "New Demo",
    allowedDomains: ["https://new.example.com"],
    role: "owner",
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

describe("App 온보딩", () => {
  const emptyAuth = {
    user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
    projects: [],
    csrfToken: "csrf_1",
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("프로젝트가 없으면 생성 폼을 보여준다", async () => {
    api.getAuthMe.mockResolvedValue(emptyAuth);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "첫 프로젝트를 만들어주세요." })).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toBeInTheDocument();
    expect(screen.getByLabelText("허용 도메인")).toBeInTheDocument();
  });

  it("프로젝트를 만들면 설치 스니펫을 보여준다", async () => {
    api.getAuthMe.mockResolvedValue(emptyAuth);
    api.createProject.mockResolvedValue({ projectId: "proj_new" });
    api.getDashboardData.mockResolvedValue({
      summary: { ...baseSummary, totalEventsCount: 0 },
      issues: [],
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "내 사이트" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), {
      target: { value: "http://localhost:5174" },
    });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

    expect(await screen.findByRole("heading", { name: "스크립트를 붙여주세요." })).toBeInTheDocument();
    expect(api.createProject).toHaveBeenCalledWith(
      { name: "내 사이트", allowedDomains: ["http://localhost:5174"] },
      "csrf_1",
    );
    expect(screen.getByText(/data-project-id="proj_new"/)).toBeInTheDocument();
  });

  it("첫 이벤트가 도착하면 대시보드로 넘어가는 버튼을 보여준다", async () => {
    vi.useFakeTimers();
    api.getAuthMe.mockResolvedValue(emptyAuth);
    api.createProject.mockResolvedValue({ projectId: "proj_new" });
    // 폴링은 install 화면에 들어간 뒤 3 초 시점에 처음 호출된다. mockResolvedValueOnce 로
    // 0 을 먼저 두면 첫 폴링이 0 을 받아 아래 도착 단정이 3 초에 성립하지 않는다.
    api.getDashboardData.mockResolvedValue({
      summary: { ...baseSummary, totalEventsCount: 3 },
      issues: [],
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(0);
    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "내 사이트" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), {
      target: { value: "http://localhost:5174" },
    });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText("아직 이벤트를 기다리고 있습니다.")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(3000);

    expect(screen.getByText("첫 이벤트가 도착했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대시보드 보기" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("생성이 실패하면 오류를 폼에 표시한다", async () => {
    api.getAuthMe.mockResolvedValue(emptyAuth);
    api.createProject.mockRejectedValue(new api.ApiError(400, "invalid_allowed_domains"));

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "내 사이트" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), { target: { value: "localhost" } });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

    expect(await screen.findByText("invalid_allowed_domains")).toBeInTheDocument();
  });

  it("대시보드에서 설치 안내로 돌아갈 수 있다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "설치 안내" }));

    expect(await screen.findByRole("heading", { name: "스크립트를 붙여주세요." })).toBeInTheDocument();
  });
});

describe("App 프로젝트 설정", () => {
  it("대시보드에서 프로젝트 설정 화면으로 이동한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(api.getProjectSettings).toHaveBeenCalledWith("proj_demo");
    expect(await screen.findByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toHaveValue("Demo");
  });

  it("설정 조회에서 프로젝트를 찾지 못하면 대시보드로 돌아갈 수 있다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectSettings.mockRejectedValue(new api.ApiError(404, "project_not_found"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByRole("heading", { name: "프로젝트를 찾을 수 없습니다." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));
    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();
  });

  it("프로젝트 설정을 저장하고 성공 메시지를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "New Demo" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), {
      target: { value: "https://new.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(api.updateProjectSettings).toHaveBeenCalledWith(
      "proj_demo",
      { name: "New Demo", allowedDomains: ["https://new.example.com"] },
      "csrf_1",
    );
    expect(await screen.findByText("저장했습니다.")).toBeInTheDocument();
  });

  it("viewer는 프로젝트 설정을 읽기 전용으로 본다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "viewer@example.com", name: "Viewer" },
      projects: [{ projectId: "proj_demo", role: "viewer" }],
      csrfToken: "csrf_1",
    });
    api.getProjectSettings.mockResolvedValue({
      projectId: "proj_demo",
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
      role: "viewer",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByText("읽기 전용 권한입니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("프로젝트 설정 저장 실패를 한국어 안내로 표시한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.updateProjectSettings.mockRejectedValue(new api.ApiError(400, "invalid_project_settings"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "New Demo" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("프로젝트 설정 값이 올바르지 않습니다.")).toBeInTheDocument();
    expect(screen.queryByText("invalid_project_settings")).not.toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toHaveValue("New Demo");
  });

  it("로그아웃 뒤 지연된 설정 조회 응답이 화면을 덮어쓰지 않는다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    let resolveSettings: (project: {
      projectId: string;
      name: string;
      allowedDomains: string[];
      role: "owner";
    }) => void;
    api.getProjectSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();

    await act(async () => {
      resolveSettings!({
        projectId: "proj_demo",
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
        role: "owner",
      });
    });

    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
  });
});
