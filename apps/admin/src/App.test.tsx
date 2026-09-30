import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  getProjectSettings: vi.fn(),
  logout: vi.fn(),
  updateProjectSettings: vi.fn(),
  getSessionTimeline: vi.fn(),
  getSessions: vi.fn(),
  getRecordingManifest: vi.fn(),
  getRecordingChunk: vi.fn(),
  getPageStats: vi.fn(),
}));

vi.mock("./api", () => ({
  ApiError: api.ApiError,
  getAuthMe: api.getAuthMe,
  getLoginOptions: api.getLoginOptions,
  createProject: api.createProject,
  getProjectSettings: api.getProjectSettings,
  logout: api.logout,
  updateProjectSettings: api.updateProjectSettings,
  getSessionTimeline: api.getSessionTimeline,
  getSessions: api.getSessions,
  getRecordingManifest: api.getRecordingManifest,
  getRecordingChunk: api.getRecordingChunk,
  getPageStats: api.getPageStats,
}));

// 프로젝트마다 다른 세션을 돌려준다. 화면에 어느 프로젝트의 목록이 그려졌는지
// 세션 ID 로 가려 본다.
function sessionsFor(projectId: string) {
  return [{
    sessionId: `${projectId}_sess`,
    startedAt: "2026-08-24T00:00:00.000Z",
    lastSeenAt: "2026-08-24T00:05:00.000Z",
    eventCount: 12,
    hasRecording: false,
  }];
}

function mockSessionsByProject() {
  api.getSessions.mockImplementation((projectId: string) => Promise.resolve(sessionsFor(projectId)));
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getLoginOptions.mockResolvedValue({ googleLogin: true, localLogin: false });
  api.getSessions.mockResolvedValue([]);
  api.getRecordingManifest.mockResolvedValue([]);
  api.getProjectSettings.mockResolvedValue({
    projectId: "proj_demo",
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
    replay: { enabled: false, maskSelectors: [] },
  });
  api.updateProjectSettings.mockResolvedValue({
    projectId: "proj_demo",
    name: "New Demo",
    allowedDomains: ["https://new.example.com"],
    replay: { enabled: false, maskSelectors: [] },
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
        projects: [{ projectId: "proj_demo" }],
        csrfToken: "csrf_1",
      });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "연결할 수 없습니다." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("heading", { level: 1, name: "세션" })).toBeInTheDocument();
  });

  it("로그인하면 세션 화면을 열고 문제 요약은 부르지 않는다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "adm_1", email: "admin@example.com" },
      projects: [{ projectId: "proj_1" }],
      csrfToken: "csrf",
      auth: { googleLogin: true, localLogin: false },
    });
    api.getSessions.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "세션" })).toBeInTheDocument();
    expect(api.getSessions).toHaveBeenCalledWith("proj_1");
    // 이 파일은 fetch 대신 api 모듈을 목으로 바꾼다. 인증과 세션 목록 말고는
    // 어떤 API 도 부르지 않아야 한다 - 문제 요약(/summary)·목록(/issues)이 여기에 든다.
    const otherCalls = Object.entries(api)
      .filter(([name]) => name !== "getAuthMe" && name !== "getSessions")
      .filter(([, fn]) => vi.isMockFunction(fn) && fn.mock.calls.length > 0)
      .map(([name]) => name);
    expect(otherCalls).toEqual([]);
  });

  it("ready 대시보드에서 현재 프로젝트 세션 목록을 주기적으로 갱신한다", async () => {
    vi.useFakeTimers();
    try {
      api.getAuthMe.mockResolvedValue({
        user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
        projects: [{ projectId: "proj_demo" }],
        csrfToken: "csrf_1",
      });
      api.getSessions
        .mockResolvedValueOnce(sessionsFor("proj_first"))
        .mockResolvedValueOnce(sessionsFor("proj_refreshed"));

      render(<App />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("proj_first_sess")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByText("proj_refreshed_sess")).toBeInTheDocument();
      expect(api.getSessions).toHaveBeenLastCalledWith("proj_demo");
    } finally {
      vi.useRealTimers();
    }
  });

  it("posts logout with the CSRF token", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
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
      projects: [{ projectId: "proj_demo" }],
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
    // 빈 목록을 먼저 두면 첫 폴링이 0 을 받아 아래 도착 단정이 3 초에 성립하지 않는다.
    api.getSessions.mockResolvedValue([{
      sessionId: "sess_first",
      startedAt: "2026-08-24T00:00:00.000Z",
      lastSeenAt: "2026-08-24T00:00:01.000Z",
      eventCount: 3,
      hasRecording: false,
    }]);

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
      projects: [{ projectId: "proj_demo" }],
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
    mockSessionsByProject();
  });

  it("단일 프로젝트 계정에서도 프로젝트 select를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
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
        { projectId: "proj_demo" },
        { projectId: "proj_second" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    expect(await screen.findByLabelText("프로젝트")).toHaveValue("proj_second");
    expect(api.getSessions).toHaveBeenCalledWith("proj_second");
    expect(await screen.findByText("proj_second_sess")).toBeInTheDocument();
  });

  it("저장된 프로젝트가 현재 계정 프로젝트가 아니면 첫 번째 프로젝트로 fallback한다", async () => {
    window.localStorage.setItem("trace.selectedProjectId", "proj_removed");
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo" },
        { projectId: "proj_second" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    expect(await screen.findByLabelText("프로젝트")).toHaveValue("proj_demo");
    expect(api.getSessions).toHaveBeenCalledWith("proj_demo");
    expect(window.localStorage.getItem("trace.selectedProjectId")).toBe("proj_demo");
  });
});

describe("App 프로젝트 전환 동작", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockSessionsByProject();
    api.getSessionTimeline.mockResolvedValue([]);
  });

  it("프로젝트를 바꾸면 새 프로젝트 대시보드를 조회하고 선택값을 저장한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo" },
        { projectId: "proj_second" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByText("proj_second_sess")).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트")).toHaveValue("proj_second");
    expect(api.getSessions).toHaveBeenLastCalledWith("proj_second");
    expect(window.localStorage.getItem("trace.selectedProjectId")).toBe("proj_second");
  });

  it("전환 후 설치 안내 스니펫은 새 프로젝트 ID를 사용한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo" },
        { projectId: "proj_second" },
      ],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });
    expect(await screen.findByText("proj_second_sess")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "설치 안내" }));

    expect(await screen.findByRole("heading", { name: "스크립트를 붙여주세요." })).toBeInTheDocument();
    expect(screen.getByText(/data-project-id="proj_second"/)).toBeInTheDocument();
  });

  it("전환 후 프로젝트 설정 조회는 새 프로젝트 ID를 사용한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo" },
        { projectId: "proj_second" },
      ],
      csrfToken: "csrf_1",
    });
    api.getProjectSettings.mockResolvedValue({
      projectId: "proj_second",
      name: "Second",
      allowedDomains: ["https://second.example.com"],
      replay: { enabled: false, maskSelectors: [] },
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });
    expect(await screen.findByText("proj_second_sess")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 설정" }));

    expect(api.getProjectSettings).toHaveBeenCalledWith("proj_second");
    expect(await screen.findByDisplayValue("Second")).toBeInTheDocument();
  });

  it("프로젝트 전환이 401을 받으면 로그인 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo" },
        { projectId: "proj_second" },
      ],
      csrfToken: "csrf_1",
    });
    api.getSessions.mockImplementation((projectId: string) => {
      if (projectId === "proj_second") return Promise.reject(new api.ApiError(401, "admin_auth_required"));
      return Promise.resolve(sessionsFor(projectId));
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
  });

  it("프로젝트 전환이 네트워크 오류를 받으면 연결 실패 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo" },
        { projectId: "proj_second" },
      ],
      csrfToken: "csrf_1",
    });
    api.getSessions.mockImplementation((projectId: string) => {
      if (projectId === "proj_second") return Promise.reject(new Error("network unavailable"));
      return Promise.resolve(sessionsFor(projectId));
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByRole("heading", { name: "연결할 수 없습니다." })).toBeInTheDocument();
  });
});

describe("App 프로젝트 설정", () => {
  it("대시보드에서 프로젝트 설정 화면으로 이동한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
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
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    api.getProjectSettings.mockRejectedValue(new api.ApiError(404, "project_not_found"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));

    expect(await screen.findByRole("heading", { name: "프로젝트를 찾을 수 없습니다." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));
    expect(await screen.findByRole("heading", { level: 1, name: "세션" })).toBeInTheDocument();
  });

  it("프로젝트 설정을 저장하고 성공 메시지를 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
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
      {
        name: "New Demo",
        allowedDomains: ["https://new.example.com"],
        replay: { enabled: false, maskSelectors: [] },
      },
      "csrf_1",
    );
    expect(await screen.findByText("저장했습니다.")).toBeInTheDocument();
  });

  it("프로젝트 설정 저장 실패를 한국어 안내로 표시한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
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

  it("설정 저장이 401을 받으면 로그인 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
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
      replay: { enabled: false, maskSelectors: [] },
    };
    let resolveSettings!: (value: typeof staleSettings) => void;

    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [
        { projectId: "proj_demo" },
        { projectId: "proj_second" },
      ],
      csrfToken: "csrf_1",
    });
    mockSessionsByProject();
    api.getProjectSettings.mockImplementationOnce(
      () => new Promise<typeof staleSettings>((resolve) => {
        resolveSettings = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
    expect(api.getProjectSettings).toHaveBeenCalledWith("proj_demo");

    fireEvent.change(screen.getByLabelText("프로젝트"), { target: { value: "proj_second" } });
    expect(await screen.findByText("proj_second_sess")).toBeInTheDocument();

    await act(async () => {
      resolveSettings(staleSettings);
    });

    expect(screen.getByText("proj_second_sess")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
  });

  it("로그아웃 뒤 지연된 설정 조회 응답이 화면을 덮어쓰지 않는다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    let resolveSettings: (project: {
      projectId: string;
      name: string;
      allowedDomains: string[];
      replay: { enabled: boolean; maskSelectors: string[] };
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
        replay: { enabled: false, maskSelectors: [] },
      });
    });

    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 설정" })).not.toBeInTheDocument();
  });

});

describe("App 페이지 통계", () => {
  const pageStatsRows = [
    {
      urlPath: "/home",
      views: 120,
      averageDwellMs: 45_000,
      exitRate: 0.42,
      scrollReach: [
        { depth: 25, ratio: 0.9 },
        { depth: 50, ratio: 0.6 },
        { depth: 75, ratio: 0.3 },
        { depth: 100, ratio: 0.1 },
      ],
    },
  ];

  it("대시보드에서 페이지 통계로 이동해 목록을 보여준다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    api.getPageStats.mockResolvedValue(pageStatsRows);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "페이지 통계" }));

    expect(await screen.findByRole("heading", { name: "페이지 통계" })).toBeInTheDocument();
    expect(api.getPageStats).toHaveBeenCalledWith("proj_demo");
    expect(screen.getByText("/home")).toBeInTheDocument();
  });

  it("페이지 통계에서 대시보드로 돌아갈 수 있다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    api.getPageStats.mockResolvedValue(pageStatsRows);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "페이지 통계" }));
    expect(await screen.findByRole("heading", { name: "페이지 통계" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));

    expect(await screen.findByRole("heading", { level: 1, name: "세션" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "페이지 통계" })).not.toBeInTheDocument();
  });

  it("페이지 통계 조회가 401을 받으면 로그인 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    api.getPageStats.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "페이지 통계" }));

    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
  });

  it("페이지 통계 조회가 403을 받으면 접근 권한 없음 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    api.getPageStats.mockRejectedValue(new api.ApiError(403, "project_access_denied"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "페이지 통계" }));

    expect(await screen.findByRole("heading", { name: "접근 권한이 없습니다." })).toBeInTheDocument();
  });

  it("페이지 통계 조회가 다른 오류를 받으면 연결 실패 화면으로 전환한다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    api.getPageStats.mockRejectedValue(new Error("network unavailable"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "페이지 통계" }));

    expect(await screen.findByRole("heading", { name: "연결할 수 없습니다." })).toBeInTheDocument();
  });

  // handleShowPageStats 의 성공 경로는 current.projectId 를 확인하고 나서
  // 상태를 바꾼다. 실패 경로는 그 확인 없이 곧장 setState 했었다 — 요청이
  // 늦게 실패하면 그 사이 사용자가 로그아웃해도 실패 처리가 로그인 화면을
  // "연결할 수 없습니다." 로 덮어썼다. 그래서 여기서는 일부러 성공이 아니라
  // 실패로 지연시킨다 - 성공 경로를 지연시키면 이미 있던 가드 때문에 고친
  // 코드든 고치기 전 코드든 항상 통과해 버려 이 결함을 잡지 못한다.
  it("로그아웃 뒤 지연된 페이지 통계 응답은 화면을 덮어쓰지 않는다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    let rejectPageStats: (error: unknown) => void = () => undefined;
    api.getPageStats.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPageStats = reject;
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "페이지 통계" }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();

    await act(async () => {
      rejectPageStats(new Error("stale failure"));
    });

    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "연결할 수 없습니다." })).not.toBeInTheDocument();
  });
});

describe("App 세션 재생", () => {
  const recordedSession = {
    sessionId: "sess_replay",
    startedAt: "2026-09-15T00:00:00.000Z",
    lastSeenAt: "2026-09-15T00:00:10.000Z",
    eventCount: 40,
    hasRecording: true,
  };

  beforeEach(() => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo" }],
      csrfToken: "csrf_1",
    });
    api.getSessions.mockResolvedValue([recordedSession]);
  });

  it("타임라인을 누르면 세션 상세 다이얼로그가 열린다", async () => {
    api.getSessionTimeline.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("sess_replay")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const dialog = await screen.findByRole("dialog", { name: "세션 상세" });
    expect(within(dialog).getByText("sess_replay")).toBeInTheDocument();
    expect(api.getSessionTimeline).toHaveBeenCalledWith("proj_demo", "sess_replay");
  });

  it("대시보드의 세션 목록에서 재생 화면으로 들어가고 다시 돌아온다", async () => {
    render(<App />);

    expect(await screen.findByText("sess_replay")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(await screen.findByRole("heading", { name: "세션 재생" })).toBeInTheDocument();
    expect(api.getRecordingManifest).toHaveBeenCalledWith("proj_demo", "sess_replay");

    fireEvent.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));

    expect(await screen.findByRole("heading", { level: 1, name: "세션" })).toBeInTheDocument();
    expect(screen.getByText("sess_replay")).toBeInTheDocument();
  });

  it("재생 중 세션이 만료되면 로그인 화면으로 돌아간다", async () => {
    api.getRecordingManifest.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));

    render(<App />);

    expect(await screen.findByText("sess_replay")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(await screen.findByText("관리자 로그인이 필요합니다.")).toBeInTheDocument();
  });

  // 세션 목록이 첫 화면 전체다. 실패를 빈 목록으로 삼키면 "아직 수집된 세션이
  // 없습니다" 가 떠서 실제로는 불러오지 못한 것을 없는 것으로 잘못 알린다.
  it("세션 목록을 불러오지 못하면 연결 실패 화면을 보여준다", async () => {
    api.getSessions.mockRejectedValue(new api.ApiError(500, "internal_error"));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "연결할 수 없습니다." })).toBeInTheDocument();
    expect(screen.queryByText(/아직 수집된 세션이 없습니다/)).not.toBeInTheDocument();
  });
});
