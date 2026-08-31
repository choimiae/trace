import type { DashboardSummary, Issue } from "@trace/shared";
import { useEffect, useState } from "react";
import {
  ApiError,
  addProjectMember,
  createProject,
  getAuthMe,
  getDashboardData,
  getProjectMembers,
  getProjectSettings,
  logout,
  removeProjectMember,
  updateProjectMemberRole,
  updateProjectSettings,
  type AddProjectMemberInput,
  type ProjectMemberResponse,
  type ProjectRole,
  type ProjectSettingsResponse,
} from "./api.js";
import { API_BASE_URL } from "./config.js";
import { readSelectedProjectId, writeSelectedProjectId } from "./storage.js";
import { CreateProjectPage } from "./pages/CreateProjectPage.js";
import { DashboardPage, type ProjectOption } from "./pages/DashboardPage.js";
import { InstallPage } from "./pages/InstallPage.js";
import { IssueDetailPage } from "./pages/IssueDetailPage.js";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage.js";
import { StatusPage } from "./pages/StatusPage.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./pages/pages.css";

type AppState =
  | { type: "loading" }
  | { type: "login" }
  | { type: "forbidden" }
  | { type: "network" }
  | { type: "create-project"; csrfToken: string; createError?: string | undefined }
  | { type: "install"; projectId: string; eventsSeen: number }
  | {
      type: "ready";
      data: { summary: DashboardSummary; issues: Issue[] };
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
      settingsError?: string | undefined;
    }
  | {
      type: "settings-not-found";
      dashboardData: { summary: DashboardSummary; issues: Issue[] };
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
    }
  | {
      type: "settings";
      project: ProjectSettingsResponse;
      dashboardData: { summary: DashboardSummary; issues: Issue[] };
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      adminUserId: string;
      currentAdminUserId: string;
      csrfToken: string;
      members: ProjectMemberResponse[];
      saving?: boolean;
      error?: string | undefined;
      savedMessage?: string | undefined;
      addingMember?: boolean;
      memberError?: string | undefined;
      memberSavedMessage?: string | undefined;
      memberActionInFlight?: string | undefined;
      memberActionError?: string | undefined;
      memberActionSavedMessage?: string | undefined;
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
  project_access_denied: "더 이상 이 프로젝트의 멤버가 아닙니다.",
  project_role_forbidden: "이 작업을 수행할 권한이 없습니다.",
  project_not_found: "프로젝트를 찾을 수 없습니다.",
  invalid_project_settings: "프로젝트 설정 값이 올바르지 않습니다.",
};

function describeProjectSettingsError(error: unknown): string {
  return describeApiError(PROJECT_SETTINGS_ERROR_MESSAGES, error, "프로젝트 설정을 저장하지 못했습니다.");
}

const PROJECT_MEMBER_ERROR_MESSAGES: Record<string, string> = {
  admin_user_not_found: "해당 이메일의 관리자를 찾을 수 없습니다.",
  project_member_exists: "이미 이 프로젝트의 멤버입니다.",
  project_role_forbidden: "멤버를 추가할 권한이 없습니다.",
  invalid_project_member: "멤버 이메일 또는 역할이 올바르지 않습니다.",
  csrf_origin_invalid: "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
  csrf_token_invalid: "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
};

function describeProjectMemberError(error: unknown): string {
  return describeApiError(PROJECT_MEMBER_ERROR_MESSAGES, error, "멤버를 추가하지 못했습니다.");
}

function memberRoleUpdateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.message === "project_role_forbidden") return "멤버를 관리할 권한이 없습니다.";
    if (error.message === "project_member_not_found") return "멤버를 찾을 수 없습니다.";
    if (error.message === "last_owner_forbidden") return "마지막 소유자는 변경하거나 제거할 수 없습니다.";
    if (error.message === "self_owner_change_forbidden") return "내 소유자 권한은 직접 변경할 수 없습니다.";
    if (error.message === "invalid_project_member") return "멤버 역할이 올바르지 않습니다.";
    if (error.message === "csrf_origin_invalid" || error.message === "csrf_token_invalid") {
      return "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.";
    }
  }
  return "멤버를 변경하지 못했습니다.";
}

function memberRemoveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.message === "project_role_forbidden") return "멤버를 관리할 권한이 없습니다.";
    if (error.message === "project_member_not_found") return "멤버를 찾을 수 없습니다.";
    if (error.message === "last_owner_forbidden") return "마지막 소유자는 변경하거나 제거할 수 없습니다.";
    if (error.message === "self_owner_change_forbidden") return "내 소유자 권한은 직접 변경할 수 없습니다.";
    if (error.message === "csrf_origin_invalid" || error.message === "csrf_token_invalid") {
      return "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.";
    }
  }
  return "멤버를 제거하지 못했습니다.";
}

// 프로젝트 생성 라우트가 반환할 수 있는 오류 코드를 한국어 안내로 옮긴다.
// apps/api/src/routes/admin-proxy.ts 의 POST project 핸들러(20-34) 기준.
// 401 admin_auth_required 는 login 화면으로 전이하므로 이 지도에 담지 않는다.
const CREATE_PROJECT_ERROR_MESSAGES: Record<string, string> = {
  csrf_origin_invalid: "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
  csrf_token_invalid: "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.",
  invalid_allowed_domains: "허용 도메인 형식이 올바르지 않습니다.",
};

function describeCreateProjectError(error: unknown): string {
  return describeApiError(CREATE_PROJECT_ERROR_MESSAGES, error, "프로젝트를 만들지 못했습니다.");
}

export function App() {
  const [state, setState] = useState<AppState>({ type: "loading" });
  const [selectedIssue, setSelectedIssue] = useState<Issue>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setState({ type: "loading" });
      setSelectedIssue(undefined);

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

        const data = await getDashboardData(projectId);
        if (active) {
          setState({
            type: "ready",
            data,
            projects: auth.projects,
            projectId,
            userEmail: auth.user.email,
            adminUserId: auth.user.adminUserId,
            csrfToken: auth.csrfToken,
          });
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setState({ type: "login" });
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
      void getDashboardData(projectId)
        .then((data) => {
          if (!active || data.summary.totalEventsCount === 0) return;
          setState((current) =>
            current.type === "install"
              ? { ...current, eventsSeen: data.summary.totalEventsCount }
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

  if (state.type === "loading") return <StatusPage title="불러오는 중" />;

  if (state.type === "login") {
    return (
      <StatusPage
        title="관리자 로그인이 필요합니다."
        action={{
          label: "Google로 로그인",
          onClick: () => {
            window.location.href = `${API_BASE_URL}/auth/google/start`;
          },
        }}
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
              data: state.dashboardData,
              projects: state.projects,
              projectId: state.projectId,
              userEmail: state.userEmail,
              adminUserId: state.adminUserId,
              csrfToken: state.csrfToken,
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
      const [project, members] = await Promise.all([
        getProjectSettings(projectId),
        getProjectMembers(projectId),
      ]);
      // 조회가 끝나기 전에 로그아웃하거나 다른 프로젝트로 전환했다면 지연
      // 응답으로 현재 화면을 덮어쓰지 않는다.
      setState((current) =>
        current.type === "ready" && current.projectId === projectId
          ? {
              type: "settings",
              project,
              members,
              dashboardData: current.data,
              projects: current.projects,
              projectId: current.projectId,
              userEmail: current.userEmail,
              adminUserId: current.adminUserId,
              csrfToken: current.csrfToken,
              currentAdminUserId: current.adminUserId,
              memberActionInFlight: undefined,
              memberActionError: undefined,
              memberActionSavedMessage: undefined,
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
            dashboardData: current.data,
            projects: current.projects,
            projectId: current.projectId,
            userEmail: current.userEmail,
            adminUserId: current.adminUserId,
            csrfToken: current.csrfToken,
          };
        }
        return { type: "network" };
      });
    }
  };

  if (state.type === "settings") {
    const handleSaveSettings = async (input: { name: string; allowedDomains: string[] }) => {
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

    const handleAddMember = async (input: AddProjectMemberInput) => {
      const projectId = state.projectId;
      const csrfToken = state.csrfToken;
      setState((current) =>
        current.type === "settings" && current.projectId === projectId
          ? Object.assign({}, current, {
              addingMember: true,
              memberError: undefined,
              memberSavedMessage: undefined,
            })
          : current,
      );
      try {
        const member = await addProjectMember(projectId, input, csrfToken);
        setState((current) =>
          current.type === "settings" && current.projectId === projectId
            ? Object.assign({}, current, {
                members: current.members.concat(member),
                addingMember: false,
                memberSavedMessage: "멤버를 추가했습니다.",
              })
            : current,
        );
      } catch (error) {
        setState((current) => {
          if (current.type !== "settings" || current.projectId !== projectId) return current;
          if (error instanceof ApiError && error.status === 401) return { type: "login" };
          return Object.assign({}, current, {
            addingMember: false,
            memberError: describeProjectMemberError(error),
          });
        });
      }
    };

    const handleUpdateMemberRole = async (adminUserId: string, role: ProjectRole) => {
      if (state.type !== "settings") return;
      const projectId = state.projectId;
      const csrfToken = state.csrfToken;
      setState(Object.assign({}, state, {
        memberActionInFlight: adminUserId,
        memberActionError: undefined,
        memberActionSavedMessage: undefined,
      }));

      try {
        const updated = await updateProjectMemberRole(projectId, adminUserId, { role }, csrfToken);
        setState((current) => {
          if (current.type !== "settings" || current.projectId !== projectId) return current;
          return Object.assign({}, current, {
            members: current.members.map((member) => member.adminUserId === updated.adminUserId ? updated : member),
            memberActionInFlight: undefined,
            memberActionError: undefined,
            memberActionSavedMessage: "멤버 역할을 변경했습니다.",
          });
        });
      } catch (error) {
        setState((current) => {
          if (current.type !== "settings" || current.projectId !== projectId) return current;
          return Object.assign({}, current, {
            memberActionInFlight: undefined,
            memberActionError: memberRoleUpdateErrorMessage(error),
            memberActionSavedMessage: undefined,
          });
        });
      }
    };

    const handleRemoveMember = async (adminUserId: string) => {
      if (state.type !== "settings") return;
      const projectId = state.projectId;
      const csrfToken = state.csrfToken;
      setState(Object.assign({}, state, {
        memberActionInFlight: adminUserId,
        memberActionError: undefined,
        memberActionSavedMessage: undefined,
      }));

      try {
        await removeProjectMember(projectId, adminUserId, csrfToken);
        setState((current) => {
          if (current.type !== "settings" || current.projectId !== projectId) return current;
          return Object.assign({}, current, {
            members: current.members.filter((member) => member.adminUserId !== adminUserId),
            memberActionInFlight: undefined,
            memberActionError: undefined,
            memberActionSavedMessage: "멤버를 제거했습니다.",
          });
        });
      } catch (error) {
        setState((current) => {
          if (current.type !== "settings" || current.projectId !== projectId) return current;
          return Object.assign({}, current, {
            memberActionInFlight: undefined,
            memberActionError: memberRemoveErrorMessage(error),
            memberActionSavedMessage: undefined,
          });
        });
      }
    };

    return (
      <ProjectSettingsPage
        project={state.project}
        members={state.members}
        currentAdminUserId={state.currentAdminUserId}
        memberActionInFlight={state.memberActionInFlight}
        memberActionError={state.memberActionError}
        memberActionSavedMessage={state.memberActionSavedMessage}
        saving={state.saving === true}
        addingMember={state.addingMember === true}
        error={state.error}
        savedMessage={state.savedMessage}
        memberError={state.memberError}
        memberSavedMessage={state.memberSavedMessage}
        onSave={(input) => { void handleSaveSettings(input); }}
        onAddMember={(input) => { void handleAddMember(input); }}
        onUpdateMemberRole={(adminUserId, role) => { void handleUpdateMemberRole(adminUserId, role); }}
        onRemoveMember={(adminUserId) => { void handleRemoveMember(adminUserId); }}
        onBack={() =>
          setState({
            type: "ready",
            data: state.dashboardData,
            projects: state.projects,
            projectId: state.projectId,
            userEmail: state.userEmail,
            adminUserId: state.adminUserId,
            csrfToken: state.csrfToken,
          })
        }
      />
    );
  }

  const handleLogout = async () => {
    try {
      await logout(state.csrfToken);
      setSelectedIssue(undefined);
      setState({ type: "login" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSelectedIssue(undefined);
        setState({ type: "login" });
      } else if (error instanceof ApiError && error.status === 403) {
        setState({ type: "forbidden" });
      } else {
        setState({ type: "network" });
      }
    }
  };

  const handleSelectProject = async (nextProjectId: string) => {
    if (state.type !== "ready" || nextProjectId === state.projectId) return;

    const projects = state.projects;
    const userEmail = state.userEmail;
    const adminUserId = state.adminUserId;
    const csrfToken = state.csrfToken;

    writeSelectedProjectId(nextProjectId);
    setSelectedIssue(undefined);
    setState({ type: "loading" });

    try {
      const data = await getDashboardData(nextProjectId);
      setState({
        type: "ready",
        data,
        projects,
        projectId: nextProjectId,
        userEmail,
        adminUserId,
        csrfToken,
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
        summary={state.data.summary}
        issues={state.data.issues}
        userEmail={state.userEmail}
        projects={state.projects}
        projectId={state.projectId}
        onSelectProject={(projectId) => { void handleSelectProject(projectId); }}
        settingsError={state.settingsError}
        onLogout={() => { void handleLogout(); }}
        onSelectIssue={setSelectedIssue}
        onShowInstall={() =>
          setState({
            type: "install",
            projectId: state.projectId,
            eventsSeen: state.data.summary.totalEventsCount,
          })
        }
        onShowSettings={() => { void handleShowSettings(); }}
      />
      {selectedIssue ? <IssueDetailPage issue={selectedIssue} onClose={() => setSelectedIssue(undefined)} /> : null}
    </>
  );
}

function buildSnippet(projectId: string): string {
  return `<script src="${API_BASE_URL}/trace.js" data-project-id="${projectId}"></script>`;
}
