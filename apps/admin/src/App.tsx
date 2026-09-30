import type { ReplayConfig } from "@trace/shared";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  ApiError,
  createProject,
  getAuthMe,
  getLoginOptions,
  getPageStats,
  getProjectSettings,
  getSessions,
  logout,
  updateProjectSettings,
  type LoginOptionsResponse,
  type PageStatsResponse,
  type ProjectSettingsResponse,
  type SessionResponse,
} from "./api.js";
import { API_BASE_URL } from "./config.js";
import { readSelectedProjectId, writeSelectedProjectId } from "./storage.js";
import { CreateProjectPage } from "./pages/CreateProjectPage.js";
import { DashboardPage, type ProjectOption } from "./pages/DashboardPage.js";
import { InstallPage } from "./pages/InstallPage.js";
import { SessionDetailDialog } from "./pages/SessionDetailDialog.js";
import { PageStatsPage } from "./pages/PageStatsPage.js";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage.js";
import { StatusPage } from "./pages/StatusPage.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./pages/pages.css";

// 재생 화면만 rrweb 을 쓴다. 정적으로 가져오면 재생을 열지 않는 운영자도
// 재생기를 내려받는다. 별도 청크로 자른다.
const SessionReplayPage = lazy(() =>
  import("./pages/SessionReplayPage.js").then((module) => ({ default: module.SessionReplayPage })),
);

type AppState =
  | { type: "loading" }
  | { type: "login"; loginOptions?: LoginOptionsResponse | undefined }
  | { type: "forbidden" }
  | { type: "network" }
  | { type: "create-project"; csrfToken: string; createError?: string | undefined }
  | { type: "install"; projectId: string; eventsSeen: number }
  | {
      type: "ready";
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
      settingsSessionId: number;
      settingsError?: string | undefined;
    }
  | {
      type: "settings-not-found";
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
      settingsSessionId: number;
    }
  | {
      type: "settings";
      project: ProjectSettingsResponse;
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
      settingsSessionId: number;
      saving?: boolean;
      error?: string | undefined;
      savedMessage?: string | undefined;
    }
  | {
      type: "replay";
      projects: ProjectOption[];
      projectId: string;
      sessionId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
      settingsSessionId: number;
    }
  | {
      type: "page-stats";
      pages: PageStatsResponse[];
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
      settingsSessionId: number;
    };

function describeApiError(
  messages: Record<string, string>,
  error: unknown,
  fallback: string,
): string {
  if (error instanceof ApiError) {
    return messages[error.message] ?? fallback;
  }
  return fallback;
}

// 설정 저장(PATCH) 라우트가 반환할 수 있는 오류 코드를 한국어 안내로 옮긴다.
// apps/api/src/routes/admin-proxy.ts 의 PATCH project settings 핸들러 기준.
// 조회(GET) 경로는 handleShowSettings 에서 상태 코드로 직접 분기하므로 이 지도를 쓰지 않는다.
// 401 admin_auth_required 는 login 화면으로 전이하므로 이 지도에 담지 않는다.
const PROJECT_SETTINGS_ERROR_MESSAGES: Record<string, string> = {
  csrf_origin_invalid: "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
  csrf_token_invalid: "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
  project_not_found: "프로젝트를 찾을 수 없습니다.",
  invalid_project_settings: "프로젝트 설정 값이 올바르지 않습니다.",
};

function describeProjectSettingsError(error: unknown): string {
  return describeApiError(PROJECT_SETTINGS_ERROR_MESSAGES, error, "프로젝트 설정을 저장하지 못했습니다.");
}

// 프로젝트 생성 라우트가 반환할 수 있는 오류 코드를 한국어 안내로 옮긴다.
// apps/api/src/routes/admin-proxy.ts 의 POST project 핸들러(20-34) 기준.
// 401 admin_auth_required 는 login 화면으로 전이하므로 이 지도에 담지 않는다.
const CREATE_PROJECT_ERROR_MESSAGES: Record<string, string> = {
  csrf_origin_invalid: "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
  csrf_token_invalid: "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
  invalid_allowed_domains: "허용 도메인 형식이 올바르지 않습니다.",
};

const DASHBOARD_REFRESH_INTERVAL_MS = 5000;

function describeCreateProjectError(error: unknown): string {
  return describeApiError(CREATE_PROJECT_ERROR_MESSAGES, error, "프로젝트를 만들지 못했습니다.");
}

export function App() {
  const [state, setState] = useState<AppState>({ type: "loading" });
  // 기록된 세션 목록은 AppState 밖에 둔다. 설정·페이지 통계·재생을 거쳐 대시보드로
  // 돌아올 때 목록을 잃지 않으려면 그 화면들이 전부 이 값을 들고 다녀야 한다.
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionResponse>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setState({ type: "loading" });
      setSelectedSession(undefined);
      setSessions([]);

      try {
        const auth = await getAuthMe();
        const storedProjectId = readSelectedProjectId();
        const hasStored = storedProjectId
          ? auth.projects.some((project) => project.projectId === storedProjectId)
          : false;
        const projectId = hasStored ? storedProjectId : auth.projects[0]?.projectId;
        if (!projectId) {
          if (active) setState({ type: "create-project", csrfToken: auth.csrfToken });
          return;
        }

        writeSelectedProjectId(projectId);

        const loaded = await getSessions(projectId);
        if (active) {
          setSessions(loaded);
          setState({
            type: "ready",
            projects: auth.projects,
            projectId,
            userEmail: auth.user.email,
            adminUserId: auth.user.adminUserId,
            csrfToken: auth.csrfToken,
            settingsSessionId: 0,
          });
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          try {
            const loginOptions = await getLoginOptions();
            if (active) setState({ type: "login", loginOptions });
          } catch {
            if (active) setState({ type: "login" });
          }
        } else if (error instanceof ApiError && error.status === 403) {
          setState({ type: "forbidden" });
        } else {
          setState({ type: "network" });
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (state.type !== "install" || state.eventsSeen > 0) return;

    const projectId = state.projectId;
    let active = true;

    const timer = setInterval(() => {
      void getSessions(projectId)
        .then((loaded) => {
          const eventsSeen = countEvents(loaded);
          if (!active || eventsSeen === 0) return;
          setState((current) =>
            current.type === "install"
              ? { ...current, eventsSeen }
              : current,
          );
        })
        .catch(() => {
          // 폴링 실패는 무시한다. 다음 주기에 다시 시도한다.
        });
    }, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state]);

  const readyProjectId = state.type === "ready" ? state.projectId : undefined;

  useEffect(() => {
    if (readyProjectId === undefined) return;

    let active = true;
    const timer = setInterval(() => {
      void getSessions(readyProjectId)
        .then((loaded) => {
          if (!active) return;
          setSessions(loaded);
        })
        .catch(() => {
          // 백그라운드 갱신 실패는 현재 대시보드를 유지하고 다음 주기에 재시도한다.
        });
    }, DASHBOARD_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [readyProjectId]);

  if (state.type === "loading") return <StatusPage title="불러오는 중" />;

  if (state.type === "login") {
    const loginOptions = state.loginOptions ?? { googleLogin: true, localLogin: false };
    const actions = [
      ...(loginOptions.localLogin
        ? [{
            label: "로컬로 시작하기",
            variant: "primary" as const,
            onClick: () => {
              window.location.href = `${API_BASE_URL}/auth/local/start`;
            },
          }]
        : []),
      ...(loginOptions.googleLogin
        ? [{
            label: "Google로 로그인",
            variant: loginOptions.localLogin ? "secondary" as const : "primary" as const,
            onClick: () => {
              window.location.href = `${API_BASE_URL}/auth/google/start`;
            },
          }]
        : []),
    ];

    return (
      <StatusPage
        title="관리자 로그인이 필요합니다."
        actions={actions}
      />
    );
  }

  if (state.type === "forbidden") {
    return <StatusPage title="접근 권한이 없습니다." />;
  }

  if (state.type === "create-project") {
    const handleCreate = async (input: { name: string; allowedDomains: string[] }) => {
      try {
        const project = await createProject(input, state.csrfToken);
        writeSelectedProjectId(project.projectId);
        setState({ type: "install", projectId: project.projectId, eventsSeen: 0 });
      } catch (error) {
        setState((current) => {
          if (current.type !== "create-project") return current;
          if (error instanceof ApiError && error.status === 401) return { type: "login" };
          return {
            type: "create-project",
            csrfToken: current.csrfToken,
            createError: describeCreateProjectError(error),
          };
        });
      }
    };

    return <CreateProjectPage onCreate={(input) => { void handleCreate(input); }} error={state.createError} />;
  }

  if (state.type === "install") {
    return (
      <InstallPage
        projectId={state.projectId}
        snippet={buildSnippet(state.projectId)}
        eventsSeen={state.eventsSeen}
        onContinue={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  if (state.type === "network") {
    return (
      <StatusPage
        title="연결할 수 없습니다."
        description="잠시 후 다시 시도해주세요."
        action={{ label: "다시 시도", onClick: () => setReloadKey((key) => key + 1) }}
      />
    );
  }

  if (state.type === "settings-not-found") {
    return (
      <StatusPage
        title="프로젝트를 찾을 수 없습니다."
        action={{
          label: "대시보드로 돌아가기",
          onClick: () =>
            setState({
              type: "ready",
              projects: state.projects,
              projectId: state.projectId,
              userEmail: state.userEmail,
              adminUserId: state.adminUserId,
              csrfToken: state.csrfToken,
              settingsSessionId: state.settingsSessionId,
            }),
        }}
      />
    );
  }

  const handleShowSettings = async () => {
    if (state.type !== "ready") return;
    const projectId = state.projectId;
    setState((current) =>
      current.type === "ready" && current.settingsError !== undefined
        ? { ...current, settingsError: undefined }
        : current,
    );
    try {
      const project = await getProjectSettings(projectId);
      // 조회가 끝나기 전에 로그아웃하거나 다른 프로젝트로 전환했다면 지연
      // 응답으로 현재 화면을 덮어쓰지 않는다.
      setState((current) =>
        current.type === "ready" && current.projectId === projectId
          ? {
              type: "settings",
              project,
              projects: current.projects,
              projectId: current.projectId,
              userEmail: current.userEmail,
              adminUserId: current.adminUserId,
              csrfToken: current.csrfToken,
              settingsSessionId: current.settingsSessionId + 1,
            }
          : current,
      );
    } catch (error) {
      setState((current) => {
        if (current.type !== "ready" || current.projectId !== projectId) return current;
        if (error instanceof ApiError && error.status === 401) return { type: "login" };
        if (error instanceof ApiError && error.status === 403) {
          return { ...current, settingsError: "접근 권한이 없습니다." };
        }
        if (error instanceof ApiError && error.status === 404) {
          return {
            type: "settings-not-found",
            projects: current.projects,
            projectId: current.projectId,
            userEmail: current.userEmail,
            adminUserId: current.adminUserId,
            csrfToken: current.csrfToken,
            settingsSessionId: current.settingsSessionId,
          };
        }
        return { type: "network" };
      });
    }
  };

  if (state.type === "settings") {
    const handleSaveSettings = async (input: {
      name: string;
      allowedDomains: string[];
      replay: ReplayConfig;
    }) => {
      const projectId = state.projectId;
      const csrfToken = state.csrfToken;
      setState((current) =>
        current.type === "settings" && current.projectId === projectId
          ? { ...current, saving: true, error: undefined, savedMessage: undefined }
          : current,
      );
      try {
        const project = await updateProjectSettings(projectId, input, csrfToken);
        setState((current) =>
          current.type === "settings" && current.projectId === projectId
            ? { ...current, project, saving: false, savedMessage: "저장했습니다." }
            : current,
        );
      } catch (error) {
        setState((current) => {
          if (current.type !== "settings" || current.projectId !== projectId) return current;
          if (error instanceof ApiError && error.status === 401) return { type: "login" };
          return {
            ...current,
            saving: false,
            error: describeProjectSettingsError(error),
          };
        });
      }
    };

    return (
      <ProjectSettingsPage
        project={state.project}
        saving={state.saving === true}
        error={state.error}
        savedMessage={state.savedMessage}
        onSave={(input) => { void handleSaveSettings(input); }}
        onBack={() =>
          setState({
            type: "ready",
            projects: state.projects,
            projectId: state.projectId,
            userEmail: state.userEmail,
            adminUserId: state.adminUserId,
            csrfToken: state.csrfToken,
            settingsSessionId: state.settingsSessionId,
          })
        }
      />
    );
  }

  if (state.type === "page-stats") {
    return (
      <PageStatsPage
        pages={state.pages}
        onBack={() =>
          setState({
            type: "ready",
            projects: state.projects,
            projectId: state.projectId,
            userEmail: state.userEmail,
            adminUserId: state.adminUserId,
            csrfToken: state.csrfToken,
            settingsSessionId: state.settingsSessionId,
          })
        }
      />
    );
  }

  if (state.type === "replay") {
    return (
      <Suspense fallback={<p className="empty-state">재생기를 불러오는 중입니다.</p>}>
        <SessionReplayPage
          projectId={state.projectId}
          sessionId={state.sessionId}
          onBack={() =>
            setState({
              type: "ready",
              projects: state.projects,
              projectId: state.projectId,
              userEmail: state.userEmail,
              adminUserId: state.adminUserId,
              csrfToken: state.csrfToken,
              settingsSessionId: state.settingsSessionId,
            })
          }
          onAuthExpired={() => setState({ type: "login" })}
        />
      </Suspense>
    );
  }

  const handleLogout = async () => {
    try {
      await logout(state.csrfToken);
      setState({ type: "login" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ type: "login" });
      } else if (error instanceof ApiError && error.status === 403) {
        setState({ type: "forbidden" });
      } else {
        setState({ type: "network" });
      }
    }
  };

  const handleShowPageStats = async () => {
    const projectId = state.projectId;
    try {
      const pages = await getPageStats(projectId);
      setState((current) =>
        current.type === "ready" && current.projectId === projectId
          ? {
              type: "page-stats",
              pages,
              projects: current.projects,
              projectId: current.projectId,
              userEmail: current.userEmail,
              adminUserId: current.adminUserId,
              csrfToken: current.csrfToken,
              settingsSessionId: current.settingsSessionId,
            }
          : current,
      );
    } catch (error) {
      // 조회가 끝나기 전에 로그아웃하거나 다른 프로젝트로 전환했다면 지연된
      // 실패로 현재 화면을 덮어쓰지 않는다. handleShowSettings 의 catch 와
      // 같은 모양이다.
      setState((current) => {
        if (current.type !== "ready" || current.projectId !== projectId) return current;
        if (error instanceof ApiError && error.status === 401) return { type: "login" };
        if (error instanceof ApiError && error.status === 403) return { type: "forbidden" };
        return { type: "network" };
      });
    }
  };

  const handleSelectProject = async (nextProjectId: string) => {
    if (state.type !== "ready" || nextProjectId === state.projectId) return;

    const projects = state.projects;
    const userEmail = state.userEmail;
    const adminUserId = state.adminUserId;
    const csrfToken = state.csrfToken;
    const settingsSessionId = state.settingsSessionId;

    writeSelectedProjectId(nextProjectId);
    setSelectedSession(undefined);
    setSessions([]);
    setState({ type: "loading" });

    try {
      const loaded = await getSessions(nextProjectId);
      setSessions(loaded);
      setState({
        type: "ready",
        projects,
        projectId: nextProjectId,
        userEmail,
        adminUserId,
        csrfToken,
        settingsSessionId,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ type: "login" });
      } else if (error instanceof ApiError && error.status === 403) {
        setState({ type: "forbidden" });
      } else {
        setState({ type: "network" });
      }
    }
  };

  return (
    <>
      <DashboardPage
        userEmail={state.userEmail}
        projects={state.projects}
        projectId={state.projectId}
        onSelectProject={(projectId) => { void handleSelectProject(projectId); }}
        settingsError={state.settingsError}
        onLogout={() => { void handleLogout(); }}
        onCreateProject={() => setState({ type: "create-project", csrfToken: state.csrfToken })}
        onShowInstall={() =>
          setState({
            type: "install",
            projectId: state.projectId,
            eventsSeen: countEvents(sessions),
          })
        }
        onShowSettings={() => { void handleShowSettings(); }}
        onShowPageStats={() => { void handleShowPageStats(); }}
        sessions={sessions}
        onSelectSession={(sessionId) =>
          setSelectedSession(sessions.find((session) => session.sessionId === sessionId))
        }
        onReplaySession={(sessionId) =>
          setState({
            type: "replay",
            projects: state.projects,
            projectId: state.projectId,
            sessionId,
            userEmail: state.userEmail,
            adminUserId: state.adminUserId,
            csrfToken: state.csrfToken,
            settingsSessionId: state.settingsSessionId,
          })
        }
      />
      {selectedSession ? (
        <SessionDetailDialog
          projectId={state.projectId}
          sessionId={selectedSession.sessionId}
          hasRecording={selectedSession.hasRecording}
          onClose={() => setSelectedSession(undefined)}
          onAuthExpired={() => setState({ type: "login" })}
          onReplay={() => {
            const sessionId = selectedSession.sessionId;
            setSelectedSession(undefined);
            setState({
              type: "replay",
              projects: state.projects,
              projectId: state.projectId,
              sessionId,
              userEmail: state.userEmail,
              adminUserId: state.adminUserId,
              csrfToken: state.csrfToken,
              settingsSessionId: state.settingsSessionId,
            });
          }}
        />
      ) : null}
    </>
  );
}

// 세션 목록은 이벤트를 세션별로 묶어 센 것이다. 설치 안내가 "첫 이벤트가 도착했는지"만
// 알면 되므로 합계로 충분하다.
function countEvents(sessions: SessionResponse[]): number {
  return sessions.reduce((total, session) => total + session.eventCount, 0);
}

function buildSnippet(projectId: string): string {
  return `<script src="${API_BASE_URL}/trace.js" data-project-id="${projectId}"></script>`;
}
