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
  getProjectMembers: vi.fn(),
  addProjectMember: vi.fn(),
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
  getProjectMembers: api.getProjectMembers,
  addProjectMember: api.addProjectMember,
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

function dashboardDataFor(projectId: string) {
  return {
    summary: Object.assign({}, baseSummary, {
      insight: `${projectId} 인사이트`,
    }),
    issues: [{
      issueId: `${projectId}_issue`,
      projectId,
      issueType: "rage_click" as const,
      title: `${projectId} 설정 화면에서 반복 클릭`,
      summary: "같은 버튼을 반복 클릭했습니다.",
      affectedSessionsCount: 42,
      affectedUsersCount: 42,
      severityScore: 82,
      firstSeenAt: "2026-08-24T00:00:00.000Z",
      lastSeenAt: "2026-08-24T00:00:00.000Z",
      trend: "up" as const,
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new" as const,
    }],
  };
}

function mockDashboardDataByProject() {
  api.getDashboardData.mockImplementation((projectId: string) => Promise.resolve(dashboardDataFor(projectId)));
}

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
  api.getProjectMembers.mockResolvedValue([
    {
      adminUserId: "admin_1",
      email: "admin@example.com",
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    },
  ]);
  api.addProjectMember.mockResolvedValue({
    adminUserId: "admin_added",
    email: "added@example.com",
    role: "viewer",
    createdAt: "2026-08-28T00:00:00.000Z",
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

    expect(await screen.findByText("허용 도메인 형식이 올바르지 않습니다.")).toBeInTheDocument();
    expect(screen.queryByText("invalid_allowed_domains")).not.toBeInTheDocument();
  });

  it("프로젝트 생성이 401을 받으면 로그인 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue(emptyAuth);
    api.createProject.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "내 사이트" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), { target: { value: "http://localhost:5174" } });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "첫 프로젝트를 만들어주세요." })).not.toBeInTheDocument();
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

describe("App 프로젝트 전환 초기 상태", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockDashboardDataByProject();
  });

  it("단일 프로젝트 계정에서도 프로젝트 select를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    expect(await screen.findByLabelText("프로젝트")).toHaveValue("proj_demo");
  });

  it("저장된 프로젝트가 현재 계정 프로젝트면 그 프로젝트로 대시보드를 조회한다", async () => {
    window.localStorage.setItem("trace.selectedProjectId", "proj_second");
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "viewer" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    expect(await screen.findByLabelText("프로젝트")).toHaveValue("proj_second");
    expect(api.getDashboardData).toHaveBeenCalledWith("proj_second");
    expect(await screen.findByText("proj_second 설정 화면에서 반복 클릭")).toBeInTheDocument();
  });

  it("저장된 프로젝트가 현재 계정 프로젝트가 아니면 첫 번째 프로젝트로 fallback한다", async () => {
    window.localStorage.setItem("trace.selectedProjectId", "proj_removed");
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "viewer" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    expect(await screen.findByLabelText("프로젝트")).toHaveValue("proj_demo");
    expect(api.getDashboardData).toHaveBeenCalledWith("proj_demo");
    expect(window.localStorage.getItem("trace.selectedProjectId")).toBe("proj_demo");
  });
});

describe("App 프로젝트 전환 동작", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockDashboardDataByProject();
    api.getSessionTimeline.mockResolvedValue([]);
  });

  it("프로젝트를 바꾸면 새 프로젝트 대시보드를 조회하고 선택값을 저장한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "viewer" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByText("proj_second 설정 화면에서 반복 클릭")).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트")).toHaveValue("proj_second");
    expect(api.getDashboardData).toHaveBeenLastCalledWith("proj_second");
    expect(window.localStorage.getItem("trace.selectedProjectId")).toBe("proj_second");
  });

  it("프로젝트를 바꾸면 열려 있던 issue 상세를 닫는다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "viewer" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "proj_demo 설정 화면에서 반복 클릭 보기" }));
    expect(await screen.findByRole("complementary", { name: "문제 상세" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByText("proj_second 설정 화면에서 반복 클릭")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
  });

  it("전환 후 설치 안내 스니펫은 새 프로젝트 ID를 사용한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "viewer" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });
    expect(await screen.findByText("proj_second 설정 화면에서 반복 클릭")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "설치 안내" }));

    expect(await screen.findByRole("heading", { name: "스크립트를 붙여주세요." })).toBeInTheDocument();
    expect(screen.getByText(/data-project-id="proj_second"/)).toBeInTheDocument();
  });

  it("전환 후 프로젝트 설정 조회는 새 프로젝트 ID를 사용한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "admin" },
      ],
      csrfToken: "csrf_1",
    });
    api.getProjectSettings.mockResolvedValue({
      projectId: "proj_second",
      name: "Second",
      allowedDomains: ["https://second.example.com"],
      role: "admin",
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });
    expect(await screen.findByText("proj_second 설정 화면에서 반복 클릭")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 설정" }));

    expect(api.getProjectSettings).toHaveBeenCalledWith("proj_second");
    expect(await screen.findByDisplayValue("Second")).toBeInTheDocument();
  });

  it("프로젝트 전환이 401을 받으면 로그인 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "viewer" },
      ],
      csrfToken: "csrf_1",
    });
    api.getDashboardData.mockImplementation((projectId: string) => {
      if (projectId === "proj_second") return Promise.reject(new api.ApiError(401, "admin_auth_required"));
      return Promise.resolve(dashboardDataFor(projectId));
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
  });

  it("프로젝트 전환이 403을 받으면 접근 권한 없음 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "viewer" },
      ],
      csrfToken: "csrf_1",
    });
    api.getDashboardData.mockImplementation((projectId: string) => {
      if (projectId === "proj_second") return Promise.reject(new api.ApiError(403, "project_access_denied"));
      return Promise.resolve(dashboardDataFor(projectId));
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByRole("heading", { name: "접근 권한이 없습니다." })).toBeInTheDocument();
  });

  it("프로젝트 전환이 네트워크 오류를 받으면 연결 실패 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "viewer" },
      ],
      csrfToken: "csrf_1",
    });
    api.getDashboardData.mockImplementation((projectId: string) => {
      if (projectId === "proj_second") return Promise.reject(new Error("network unavailable"));
      return Promise.resolve(dashboardDataFor(projectId));
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByRole("heading", { name: "연결할 수 없습니다." })).toBeInTheDocument();
  });
});

describe("App 프로젝트 설정", () => {
  it("loads project settings and members together before opening settings", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "멤버" })).toBeInTheDocument();
    expect(api.getProjectSettings).toHaveBeenCalledWith("proj_demo");
    expect(api.getProjectMembers).toHaveBeenCalledWith("proj_demo");
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  });

  it("adds a project member and appends the returned member", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("멤버 이메일"), {
      target: { value: "added@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(await screen.findByText("멤버를 추가했습니다.")).toBeInTheDocument();
    expect(api.addProjectMember).toHaveBeenCalledWith(
      "proj_demo",
      { email: "added@example.com", role: "viewer" },
      "csrf_1",
    );
    expect(screen.getByText("added@example.com")).toBeInTheDocument();
  });

  it.each([
    ["admin_user_not_found", "해당 이메일의 관리자를 찾을 수 없습니다."],
    ["project_member_exists", "이미 이 프로젝트의 멤버입니다."],
    ["project_role_forbidden", "멤버를 추가할 권한이 없습니다."],
    ["invalid_project_member", "멤버 이메일 또는 역할이 올바르지 않습니다."],
    ["csrf_token_invalid", "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요."],
  ])("maps project member error %s to Korean", async (errorCode, message) => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.addProjectMember.mockRejectedValue(new api.ApiError(400, errorCode));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("멤버 이메일"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("ignores delayed settings member responses after project switch", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_a", role: "owner" },
        { projectId: "proj_b", role: "owner" },
      ],
      csrfToken: "csrf_1",
    });
    mockDashboardDataByProject();
    let resolveMembers: (members: unknown[]) => void = () => undefined;
    api.getProjectSettings.mockResolvedValue({
      projectId: "proj_a",
      name: "Project A",
      allowedDomains: ["https://a.example.com"],
      role: "owner",
    });
    api.getProjectMembers.mockImplementation(
      () => new Promise((resolve) => {
        resolveMembers = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_b" } });
    await screen.findByText("proj_b 인사이트");

    await act(async () => {
      resolveMembers([
        {
          adminUserId: "admin_late",
          email: "late@example.com",
          role: "viewer",
          createdAt: "2026-08-28T00:00:00.000Z",
        },
      ]);
    });

    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
    expect(screen.queryByText("late@example.com")).not.toBeInTheDocument();
  });

  it("ignores delayed settings member responses after logout", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    let resolveMembers: (members: unknown[]) => void = () => undefined;
    api.getProjectMembers.mockImplementation(
      () => new Promise((resolve) => {
        resolveMembers = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();

    await act(async () => {
      resolveMembers([
        {
          adminUserId: "admin_late",
          email: "late@example.com",
          role: "viewer",
          createdAt: "2026-08-28T00:00:00.000Z",
        },
      ]);
    });

    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
    expect(screen.queryByText("late@example.com")).not.toBeInTheDocument();
  });

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

  it("멤버십이 해제된 상태로 저장하면 한국어 안내로 표시한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.updateProjectSettings.mockRejectedValue(new api.ApiError(403, "project_access_denied"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "New Demo" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("더 이상 이 프로젝트의 멤버가 아닙니다.")).toBeInTheDocument();
    expect(screen.queryByText("project_access_denied")).not.toBeInTheDocument();
  });

  it("설정 저장이 401을 받으면 로그인 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.updateProjectSettings.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "New Demo" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
  });

  it("이전 프로젝트의 지연된 설정 조회가 전환한 프로젝트의 대시보드를 덮어쓰지 않는다", async () => {
    const staleSettings = {
      projectId: "proj_demo",
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
      role: "owner" as const,
    };
    let resolveSettings!: (value: typeof staleSettings) => void;

    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo", role: "owner" },
        { projectId: "proj_second", role: "admin" },
      ],
      csrfToken: "csrf_1",
    });
    api.getDashboardData.mockImplementation((projectId: string) => Promise.resolve(dashboardDataFor(projectId)));
    api.getProjectSettings.mockImplementationOnce(
      () => new Promise<typeof staleSettings>((resolve) => {
        resolveSettings = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    expect(api.getProjectSettings).toHaveBeenCalledWith("proj_demo");

    fireEvent.change(screen.getByLabelText("프로젝트"), { target: { value: "proj_second" } });
    expect(await screen.findByText("proj_second 설정 화면에서 반복 클릭")).toBeInTheDocument();

    await act(async () => {
      resolveSettings(staleSettings);
    });

    expect(screen.getByText("proj_second 설정 화면에서 반복 클릭")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
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

  it("설정 조회가 403이면 대시보드에 남아 인라인 안내를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectSettings.mockRejectedValueOnce(new api.ApiError(403, "project_access_denied"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("접근 권한이 없습니다.");
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
  });

  it("재시도하면 이전 안내가 사라진다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectSettings.mockRejectedValueOnce(new api.ApiError(403, "project_access_denied"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("접근 권한이 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
