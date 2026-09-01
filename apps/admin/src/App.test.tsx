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
  getLoginOptions: vi.fn(),
  createProject: vi.fn(),
  getDashboardData: vi.fn(),
  getProjectSettings: vi.fn(),
  getProjectMembers: vi.fn(),
  searchProjectMemberCandidates: vi.fn(),
  getProjectAuditLogs: vi.fn(),
  addProjectMember: vi.fn(),
  updateProjectMemberRole: vi.fn(),
  removeProjectMember: vi.fn(),
  logout: vi.fn(),
  updateProjectSettings: vi.fn(),
  getIssueDetail: vi.fn(),
  getSessionTimeline: vi.fn(),
}));

vi.mock("./api", () => ({
  ApiError: api.ApiError,
  getAuthMe: api.getAuthMe,
  getLoginOptions: api.getLoginOptions,
  createProject: api.createProject,
  getDashboardData: api.getDashboardData,
  getProjectSettings: api.getProjectSettings,
  getProjectMembers: api.getProjectMembers,
  searchProjectMemberCandidates: api.searchProjectMemberCandidates,
  getProjectAuditLogs: api.getProjectAuditLogs,
  addProjectMember: api.addProjectMember,
  updateProjectMemberRole: api.updateProjectMemberRole,
  removeProjectMember: api.removeProjectMember,
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

async function removeMemberButton(email: string) {
  return screen.findByRole("button", { name: `${email} 제거` });
}

// 활동 이력 항목은 문장으로 렌더링된다. `${email}을 조회자로 추가했습니다.` 가 보인다.
function auditLogEntry(auditLogId: string, email: string) {
  return {
    auditLogId,
    action: "project.member_added",
    createdAt: "2026-08-31T01:23:45.000Z",
    actor: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
    metadata: { email, role: "viewer" },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getLoginOptions.mockResolvedValue({ googleLogin: true, localLogin: false });
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
  api.searchProjectMemberCandidates.mockResolvedValue([
    {
      adminUserId: "admin_added",
      email: "added@example.com",
      name: "Added",
    },
  ]);
  api.getProjectAuditLogs.mockResolvedValue({
    entries: [
      {
        auditLogId: "audit_1",
        action: "project.member_added",
        createdAt: "2026-08-31T01:23:45.000Z",
        actor: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
        metadata: { email: "member@example.com", role: "viewer" },
      },
    ],
  });
  api.addProjectMember.mockResolvedValue({
    adminUserId: "admin_added",
    email: "added@example.com",
    role: "viewer",
    createdAt: "2026-08-28T00:00:00.000Z",
  });
  api.updateProjectMemberRole.mockResolvedValue({
    adminUserId: "admin_member",
    email: "member@example.com",
    name: "Member",
    role: "admin",
    createdAt: "2026-08-28T00:00:00.000Z",
  });
  api.removeProjectMember.mockResolvedValue(undefined);
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
    expect(screen.queryByRole("button", { name: "로컬로 시작하기" })).not.toBeInTheDocument();
  });

  it("renders local login when the server exposes local login only", async () => {
    api.getAuthMe.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));
    api.getLoginOptions.mockResolvedValue({ googleLogin: false, localLogin: true });

    render(<App />);

    expect(await screen.findByRole("button", { name: "로컬로 시작하기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Google로 로그인" })).not.toBeInTheDocument();
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

  it("ready 대시보드에서 현재 프로젝트 데이터를 주기적으로 갱신한다", async () => {
    vi.useFakeTimers();
    try {
      api.getAuthMe.mockResolvedValue({
        user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
        projects: [{ projectId: "proj_demo", role: "owner" }],
        csrfToken: "csrf_1",
      });
      api.getDashboardData
        .mockResolvedValueOnce({
          summary: { ...baseSummary, insight: "처음 조회된 인사이트" },
          issues: [],
        })
        .mockResolvedValueOnce({
          summary: { ...baseSummary, insight: "갱신된 인사이트" },
          issues: [],
        });

      render(<App />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("처음 조회된 인사이트")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByText("갱신된 인사이트")).toBeInTheDocument();
      expect(api.getDashboardData).toHaveBeenLastCalledWith("proj_demo");
    } finally {
      vi.useRealTimers();
    }
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

  it("대시보드에서 새 프로젝트 생성 화면으로 진입해 새 프로젝트 설치 안내를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.createProject.mockResolvedValue({ projectId: "proj_new" });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "새 프로젝트" }));
    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "내 다른 앱" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), {
      target: { value: "http://localhost:3000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

    expect(await screen.findByRole("heading", { name: "스크립트를 붙여주세요." })).toBeInTheDocument();
    expect(api.createProject).toHaveBeenCalledWith(
      { name: "내 다른 앱", allowedDomains: ["http://localhost:3000"] },
      "csrf_1",
    );
    expect(window.localStorage.getItem("trace.selectedProjectId")).toBe("proj_new");
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
    fireEvent.click(await screen.findByRole("button", { name: /added@example\.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(await screen.findByText("멤버를 추가했습니다.")).toBeInTheDocument();
    expect(api.addProjectMember).toHaveBeenCalledWith(
      "proj_demo",
      { email: "added@example.com", role: "viewer" },
      "csrf_1",
    );
    expect(screen.getByText("added@example.com", { selector: ".member-row strong" })).toBeInTheDocument();
  });

  it("updates a project member role from settings", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectMembers.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        adminUserId: "admin_member",
        email: "member@example.com",
        role: "viewer",
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("member@example.com 역할"), { target: { value: "admin" } });

    expect(await screen.findByText("멤버 역할을 변경했습니다.")).toBeInTheDocument();
    expect(api.updateProjectMemberRole).toHaveBeenCalledWith(
      "proj_demo",
      "admin_member",
      { role: "admin" },
      "csrf_1",
    );
    expect(screen.getByLabelText("member@example.com 역할")).toHaveValue("admin");
    expect(screen.getByText("관리자", { selector: ".member-meta span" })).toBeInTheDocument();
  });

  it("keeps member list and shows an error when role update fails", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectMembers.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        adminUserId: "admin_owner",
        email: "owner@example.com",
        role: "owner",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ]);
    api.updateProjectMemberRole.mockRejectedValue(new api.ApiError(403, "last_owner_forbidden"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("owner@example.com 역할"), { target: { value: "admin" } });

    expect(await screen.findByText("마지막 소유자는 변경하거나 제거할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("owner@example.com 역할")).toHaveValue("owner");
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
  });

  it("removes a project member from settings", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectMembers.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        adminUserId: "admin_member",
        email: "member@example.com",
        role: "viewer",
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await removeMemberButton("member@example.com"));

    expect(await screen.findByText("멤버를 제거했습니다.")).toBeInTheDocument();
    expect(api.removeProjectMember).toHaveBeenCalledWith("proj_demo", "admin_member", "csrf_1");
    expect(screen.queryByText("member@example.com")).not.toBeInTheDocument();
  });

  it("keeps member list and shows an error when removal fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectMembers.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        adminUserId: "admin_member",
        email: "member@example.com",
        role: "viewer",
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    ]);
    api.removeProjectMember.mockRejectedValue(new api.ApiError(403, "self_owner_change_forbidden"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await removeMemberButton("member@example.com"));

    expect(await screen.findByText("내 소유자 권한은 직접 변경할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("member@example.com")).toBeInTheDocument();
  });

  it("ignores delayed member role responses after leaving settings", async () => {
    let resolveUpdate!: (member: {
      adminUserId: string;
      email: string;
      role: "admin";
      createdAt: string;
    }) => void;
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectMembers.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        adminUserId: "admin_member",
        email: "member@example.com",
        role: "viewer",
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    ]);
    api.updateProjectMemberRole.mockImplementation(
      () => new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("member@example.com 역할"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));
    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();

    await act(async () => {
      resolveUpdate({
        adminUserId: "admin_member",
        email: "member@example.com",
        role: "admin",
        createdAt: "2026-08-28T00:00:00.000Z",
      });
    });

    expect(screen.getByText("문제 인박스")).toBeInTheDocument();
    expect(screen.queryByText("멤버 역할을 변경했습니다.")).not.toBeInTheDocument();
  });

  it("ignores a delayed member role response after re-entering the same project settings", async () => {
    let resolveUpdate!: (member: {
      adminUserId: string;
      email: string;
      role: "admin";
      createdAt: string;
    }) => void;
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectMembers.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        adminUserId: "admin_member",
        email: "member@example.com",
        role: "viewer",
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    ]);
    api.updateProjectMemberRole.mockImplementation(
      () => new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("member@example.com 역할"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));
    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    expect(await screen.findByLabelText("member@example.com 역할")).toHaveValue("viewer");

    await act(async () => {
      resolveUpdate({
        adminUserId: "admin_member",
        email: "member@example.com",
        role: "admin",
        createdAt: "2026-08-28T00:00:00.000Z",
      });
    });

    expect(screen.getByLabelText("member@example.com 역할")).toHaveValue("viewer");
    expect(screen.queryByText("멤버 역할을 변경했습니다.")).not.toBeInTheDocument();
  });

  it.each([
    ["시작 순서", [0, 1]],
    ["역순", [1, 0]],
  ])("서로 다른 멤버 역할 변경 응답 순서가 %s여도 모두 반영한다", async (_orderName, completionOrder) => {
    const resolveUpdates: Array<(member: {
      adminUserId: string;
      email: string;
      role: "admin";
      createdAt: string;
    }) => void> = [];
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectMembers.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        adminUserId: "admin_first",
        email: "first@example.com",
        role: "viewer",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
      {
        adminUserId: "admin_second",
        email: "second@example.com",
        role: "viewer",
        createdAt: "2026-08-27T00:00:00.000Z",
      },
    ]);
    api.updateProjectMemberRole.mockImplementation(
      () => new Promise((resolve) => {
        resolveUpdates.push(resolve);
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.change(await screen.findByLabelText("first@example.com 역할"), { target: { value: "admin" } });
    fireEvent.change(await screen.findByLabelText("second@example.com 역할"), { target: { value: "admin" } });

    expect(screen.getByLabelText("first@example.com 역할")).toBeDisabled();
    expect(screen.getByLabelText("second@example.com 역할")).toBeDisabled();

    const updates = [
      {
        adminUserId: "admin_first",
        email: "first@example.com",
        role: "admin" as const,
        createdAt: "2026-08-26T00:00:00.000Z",
      },
      {
        adminUserId: "admin_second",
        email: "second@example.com",
        role: "admin" as const,
        createdAt: "2026-08-27T00:00:00.000Z",
      },
    ];

    for (const index of completionOrder) {
      await act(async () => {
        resolveUpdates[index]!(updates[index]!);
      });
    }

    expect(screen.getByLabelText("first@example.com 역할")).toHaveValue("admin");
    expect(screen.getByLabelText("second@example.com 역할")).toHaveValue("admin");
  });

  it("ignores delayed member removal responses after logout", async () => {
    let resolveRemoval!: () => void;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectMembers.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        adminUserId: "admin_member",
        email: "member@example.com",
        role: "viewer",
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    ]);
    api.removeProjectMember.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveRemoval = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await removeMemberButton("member@example.com"));
    fireEvent.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();

    await act(async () => {
      resolveRemoval();
    });

    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: /added@example\.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("searches member candidates with an empty query on settings entry", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByText("added@example.com")).toBeInTheDocument();
    expect(api.searchProjectMemberCandidates).toHaveBeenCalledTimes(1);
    expect(api.searchProjectMemberCandidates).toHaveBeenCalledWith("proj_demo", "");
  });

  it("does not search member candidates for a non-owner project role", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "admin" }],
      csrfToken: "csrf_1",
    });
    api.getProjectSettings.mockResolvedValue({
      projectId: "proj_demo",
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
      role: "admin",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByText("멤버 추가 권한이 없습니다.")).toBeInTheDocument();
    expect(api.searchProjectMemberCandidates).not.toHaveBeenCalled();
  });

  it("searches member candidates when the query changes", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.searchProjectMemberCandidates
      .mockResolvedValueOnce([
        { adminUserId: "admin_added", email: "added@example.com", name: "Added" },
      ])
      .mockResolvedValueOnce([
        { adminUserId: "admin_other", email: "other@example.com", name: "Other" },
      ]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    await screen.findByText("added@example.com");

    fireEvent.change(screen.getByLabelText("멤버 검색"), { target: { value: "other" } });

    expect(await screen.findByText("other@example.com")).toBeInTheDocument();
    expect(api.searchProjectMemberCandidates).toHaveBeenLastCalledWith("proj_demo", "other");
    expect(screen.queryByText("added@example.com")).not.toBeInTheDocument();
  });

  it("ignores a delayed member candidate search response", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    let resolveStale: (candidates: unknown[]) => void = () => undefined;
    api.searchProjectMemberCandidates
      .mockResolvedValueOnce([
        { adminUserId: "admin_added", email: "added@example.com", name: "Added" },
      ])
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveStale = resolve as (candidates: unknown[]) => void;
        }),
      )
      .mockResolvedValueOnce([
        { adminUserId: "admin_fresh", email: "fresh@example.com", name: "Fresh" },
      ]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    await screen.findByText("added@example.com");

    fireEvent.change(screen.getByLabelText("멤버 검색"), { target: { value: "stale" } });
    fireEvent.change(screen.getByLabelText("멤버 검색"), { target: { value: "fresh" } });
    expect(await screen.findByText("fresh@example.com")).toBeInTheDocument();

    await act(async () => {
      resolveStale([{ adminUserId: "admin_stale", email: "stale@example.com", name: "Stale" }]);
    });

    expect(screen.queryByText("stale@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("fresh@example.com")).toBeInTheDocument();
  });

  it("keeps the settings screen when the member candidate search fails", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.searchProjectMemberCandidates.mockRejectedValue(new api.ApiError(500, "internal_error"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByText("사용자를 검색하지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
  });

  it.each([
    ["project_role_forbidden", "멤버를 검색할 권한이 없습니다."],
    ["project_access_denied", "더 이상 이 프로젝트의 멤버가 아닙니다."],
    ["invalid_member_candidate_search", "검색 조건이 올바르지 않습니다."],
  ])("maps member candidate search error %s to Korean", async (errorCode, message) => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.searchProjectMemberCandidates.mockRejectedValue(new api.ApiError(403, errorCode));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("sends the user to login when the member candidate search returns 401", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.searchProjectMemberCandidates.mockRejectedValue(
      new api.ApiError(401, "admin_auth_required"),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
  });

  it("does not select a candidate that is already a project member", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.searchProjectMemberCandidates.mockResolvedValue([
      {
        adminUserId: "admin_1",
        email: "admin@example.com",
        membership: { role: "owner" },
      },
    ]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    const candidate = await screen.findByText("이미 멤버 · 소유자");
    fireEvent.click(candidate);

    expect(screen.queryByText(/^선택됨:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "멤버 추가" })).toBeDisabled();
  });

  it("refreshes the member list and candidate state after adding a member", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: /added@example\.com/ }));

    expect(screen.getByText("선택됨: Added · added@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(await screen.findByText("멤버를 추가했습니다.")).toBeInTheDocument();
    expect(screen.getByText("added@example.com", { selector: ".member-row strong" })).toBeInTheDocument();
    expect(screen.getByText("이미 멤버 · 조회자")).toBeInTheDocument();
    expect(screen.queryByText(/^선택됨:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "멤버 추가" })).toBeDisabled();
  });

  it("keeps the candidate selection when adding a member fails", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.addProjectMember.mockRejectedValue(new api.ApiError(409, "project_member_exists"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: /added@example\.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(await screen.findByText("이미 이 프로젝트의 멤버입니다.")).toBeInTheDocument();
    expect(screen.getByText("선택됨: Added · added@example.com")).toBeInTheDocument();
    expect(screen.getByText("추가 가능")).toBeInTheDocument();
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

  it("설정 화면에서 활동 이력으로 진입해 목록을 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));

    expect(await screen.findByRole("heading", { name: "활동 이력" })).toBeInTheDocument();
    expect(api.getProjectAuditLogs).toHaveBeenCalledWith("proj_demo", undefined);
    expect(screen.getByText("member@example.com을 조회자로 추가했습니다.")).toBeInTheDocument();
  });

  it("더 보기로 다음 페이지를 이어 붙인다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectAuditLogs
      .mockResolvedValueOnce({
        entries: [auditLogEntry("audit_1", "first@example.com")],
        nextCursor: "cursor_1",
      })
      .mockResolvedValueOnce({ entries: [auditLogEntry("audit_2", "second@example.com")] });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));
    expect(await screen.findByText("first@example.com을 조회자로 추가했습니다.")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));

    expect(await screen.findByText("second@example.com을 조회자로 추가했습니다.")).toBeInTheDocument();
    expect(api.getProjectAuditLogs).toHaveBeenLastCalledWith("proj_demo", "cursor_1");
    expect(screen.getByText("first@example.com을 조회자로 추가했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
  });

  it("더 보기 실패 시 기존 목록을 유지하고 오류를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectAuditLogs
      .mockResolvedValueOnce({
        entries: [auditLogEntry("audit_1", "first@example.com")],
        nextCursor: "cursor_1",
      })
      .mockRejectedValueOnce(new api.ApiError(500, "internal_error"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));
    expect(await screen.findByText("first@example.com을 조회자로 추가했습니다.")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));

    expect(await screen.findByText("활동 이력을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByText("first@example.com을 조회자로 추가했습니다.")).toBeInTheDocument();
  });

  it("첫 로드 실패 시 오류 문구를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectAuditLogs.mockRejectedValue(new api.ApiError(500, "internal_error"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));

    expect(await screen.findByText("활동 이력을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "활동 이력" })).toBeInTheDocument();
  });

  it("활동 이력 권한 오류 문구를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectAuditLogs.mockRejectedValue(new api.ApiError(403, "project_role_forbidden"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));

    expect(await screen.findByText("활동 이력을 볼 권한이 없습니다.")).toBeInTheDocument();
  });

  it("활동 이력이 401 이면 로그인 화면으로 보낸다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.getProjectAuditLogs.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));

    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
  });

  it("설정으로 돌아가면 설정 화면을 다시 로드하고 후보 검색이 다시 발동한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));
    expect(await screen.findByRole("heading", { name: "활동 이력" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "설정으로 돌아가기" }));

    expect(await screen.findByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
    expect(api.getProjectSettings).toHaveBeenCalledTimes(2);
    expect(api.getProjectMembers).toHaveBeenCalledTimes(2);
    expect(api.searchProjectMemberCandidates).toHaveBeenCalledTimes(2);
  });

  it("활동 이력에서 설정으로 돌아갔을 때 조회가 403이면 대시보드에 인라인 안내를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));
    expect(await screen.findByRole("heading", { name: "활동 이력" })).toBeInTheDocument();

    api.getProjectSettings.mockRejectedValueOnce(new api.ApiError(403, "project_access_denied"));

    fireEvent.click(screen.getByRole("button", { name: "설정으로 돌아가기" }));

    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("접근 권한이 없습니다.");
    expect(screen.queryByRole("heading", { name: "활동 이력" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
  });

  it("늦게 도착한 활동 이력 응답은 무시한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    let resolveAuditLogs: (page: { entries: unknown[] }) => void = () => undefined;
    api.getProjectAuditLogs.mockImplementation(
      () => new Promise((resolve) => {
        resolveAuditLogs = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));
    expect(await screen.findByRole("heading", { name: "활동 이력" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "설정으로 돌아가기" }));
    expect(await screen.findByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();

    await act(async () => {
      resolveAuditLogs({ entries: [auditLogEntry("audit_late", "late@example.com")] });
    });

    expect(screen.getByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "활동 이력" })).not.toBeInTheDocument();
    expect(screen.queryByText("late@example.com을 조회자로 추가했습니다.")).not.toBeInTheDocument();
  });
});
