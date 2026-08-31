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
  searchProjectMemberCandidates,
  updateProjectMemberRole,
  updateProjectSettings,
  type AddProjectMemberInput,
  type ProjectMemberCandidateResponse,
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
      settingsSessionId: number;
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
      settingsSessionId: number;
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
      settingsSessionId: number;
      memberActionRequestIds: Record<string, number>;
      members: ProjectMemberResponse[];
      memberCandidates: ProjectMemberCandidateResponse[];
      memberCandidateSearchRequestId: number;
      memberCandidateSearchLoading: boolean;
      memberCandidateSearchError?: string | undefined;
      selectedMemberCandidate?: ProjectMemberCandidateResponse | undefined;
      saving?: boolean;
      error?: string | undefined;
      savedMessage?: string | undefined;
      addingMember?: boolean;
      memberError?: string | undefined;
      memberSavedMessage?: string | undefined;
      memberActionsInFlight: Set<string>;
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

// 후보 검색 라우트가 반환할 수 있는 오류 코드를 한국어 안내로 옮긴다.
// apps/api/src/routes/admin-proxy.ts 의 GET member-candidates 핸들러 기준.
// UI 는 owner 일 때만 검색하고 limit 을 보내지 않으므로 권한/조건 오류는 정상
// 흐름에서는 나오지 않는다. 권한이 도중에 바뀐 경우를 위해 지도에 남긴다.
// 401 admin_auth_required 는 login 화면으로 전이하므로 이 지도에 담지 않는다.
const MEMBER_CANDIDATE_SEARCH_ERROR_MESSAGES: Record<string, string> = {
  project_role_forbidden: "멤버를 검색할 권한이 없습니다.",
  project_access_denied: "더 이상 이 프로젝트의 멤버가 아닙니다.",
  invalid_member_candidate_search: "검색 조건이 올바르지 않습니다.",
};

function describeMemberCandidateSearchError(error: unknown): string {
  return describeApiError(
    MEMBER_CANDIDATE_SEARCH_ERROR_MESSAGES,
    error,
    "사용자를 검색하지 못했습니다.",
  );
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
            settingsSessionId: 0,
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

  // 진입 시 검색과 검색어 변경이 같은 guard 를 쓰게 한다. requestId 는 호출자가
  // 자기 render 의 state 에서 계산해서 넘긴다. setState updater 는 호출 시점에
  // 동기 실행되지 않으므로 updater 안에서 읽어 낼 수 없다. 기존
  // handleUpdateMemberRole 이 memberActionRequestId 를 다루는 방식과 같다.
  const runMemberCandidateSearch = (
    projectId: string,
    settingsSessionId: number,
    requestId: number,
    query: string,
  ) => {
    setState((current) =>
      current.type === "settings"
      && current.projectId === projectId
      && current.settingsSessionId === settingsSessionId
        ? Object.assign({}, current, {
            memberCandidateSearchRequestId: requestId,
            memberCandidateSearchLoading: true,
            memberCandidateSearchError: undefined,
          })
        : current,
    );

    void searchProjectMemberCandidates(projectId, query)
      .then((candidates) => {
        setState((current) =>
          current.type === "settings"
          && current.projectId === projectId
          && current.settingsSessionId === settingsSessionId
          && current.memberCandidateSearchRequestId === requestId
            ? Object.assign({}, current, {
                memberCandidates: candidates,
                memberCandidateSearchLoading: false,
                memberCandidateSearchError: undefined,
              })
            : current,
        );
      })
      .catch((error: unknown) => {
        setState((current) => {
          if (error instanceof ApiError && error.status === 401) return { type: "login" };
          if (
            current.type !== "settings"
            || current.projectId !== projectId
            || current.settingsSessionId !== settingsSessionId
            || current.memberCandidateSearchRequestId !== requestId
          ) return current;
          return Object.assign({}, current, {
            memberCandidateSearchLoading: false,
            memberCandidateSearchError: describeMemberCandidateSearchError(error),
          });
        });
      });
  };

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

  // 진입 시 후보 검색은 handleShowSettings 안에서 이어 호출하지 않는다. 그 함수의
  // settings 전이는 settingsSessionId 를 updater 안에서 계산하므로, 이어 호출하면
  // guard 에 쓸 session id 를 미리 추측해야 한다. key 가 바뀔 때만 발동하는 effect
  // 로 두고 실제 state 에서 session id 를 읽는다. key 는 발동 조건일 뿐이고
  // 인자는 state 에서 직접 읽으므로 key 형식에 기대지 않는다.
  const memberCandidateBootstrapKey = state.type === "settings" && state.project.role === "owner"
    ? `${state.projectId}:${state.settingsSessionId}`
    : undefined;

  useEffect(() => {
    if (memberCandidateBootstrapKey === undefined || state.type !== "settings") return;
    runMemberCandidateSearch(
      state.projectId,
      state.settingsSessionId,
      state.memberCandidateSearchRequestId + 1,
      "",
    );
  }, [memberCandidateBootstrapKey]);

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
              settingsSessionId: current.settingsSessionId + 1,
              memberActionRequestIds: {},
              currentAdminUserId: current.adminUserId,
              memberActionsInFlight: new Set(),
              memberActionError: undefined,
              memberActionSavedMessage: undefined,
              memberCandidates: [],
              memberCandidateSearchRequestId: 0,
              memberCandidateSearchLoading: false,
              memberCandidateSearchError: undefined,
              selectedMemberCandidate: undefined,
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
            settingsSessionId: current.settingsSessionId,
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
                memberCandidates: current.memberCandidates.map((candidate) =>
                  candidate.adminUserId === member.adminUserId
                    ? Object.assign({}, candidate, { membership: { role: member.role } })
                    : candidate,
                ),
                selectedMemberCandidate: undefined,
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

    const handleSearchMemberCandidates = (query: string) => {
      runMemberCandidateSearch(
        state.projectId,
        state.settingsSessionId,
        state.memberCandidateSearchRequestId + 1,
        query,
      );
    };

    const handleSelectMemberCandidate = (candidate: ProjectMemberCandidateResponse) => {
      if (candidate.membership !== undefined) return;
      setState((current) =>
        current.type === "settings" && current.projectId === state.projectId
          ? Object.assign({}, current, { selectedMemberCandidate: candidate })
          : current,
      );
    };

    const handleUpdateMemberRole = async (adminUserId: string, role: ProjectRole) => {
      if (state.type !== "settings") return;
      const projectId = state.projectId;
      const csrfToken = state.csrfToken;
      const settingsSessionId = state.settingsSessionId;
      const memberActionRequestId = (state.memberActionRequestIds[adminUserId] ?? 0) + 1;
      setState((current) => {
        if (
          current.type !== "settings"
          || current.projectId !== projectId
          || current.settingsSessionId !== settingsSessionId
        ) return current;
        const memberActionsInFlight = new Set(current.memberActionsInFlight);
        memberActionsInFlight.add(adminUserId);
        return Object.assign({}, current, {
          memberActionRequestIds: { ...current.memberActionRequestIds, [adminUserId]: memberActionRequestId },
          memberActionsInFlight,
          memberActionError: undefined,
          memberActionSavedMessage: undefined,
        });
      });

      try {
        const updated = await updateProjectMemberRole(projectId, adminUserId, { role }, csrfToken);
        setState((current) => {
          if (
            current.type !== "settings"
            || current.projectId !== projectId
            || current.settingsSessionId !== settingsSessionId
            || current.memberActionRequestIds[adminUserId] !== memberActionRequestId
          ) return current;
          const memberActionsInFlight = new Set(current.memberActionsInFlight);
          memberActionsInFlight.delete(adminUserId);
          return Object.assign({}, current, {
            members: current.members.map((member) => member.adminUserId === updated.adminUserId ? updated : member),
            memberActionsInFlight,
            memberActionError: undefined,
            memberActionSavedMessage: "멤버 역할을 변경했습니다.",
          });
        });
      } catch (error) {
        setState((current) => {
          if (
            current.type !== "settings"
            || current.projectId !== projectId
            || current.settingsSessionId !== settingsSessionId
            || current.memberActionRequestIds[adminUserId] !== memberActionRequestId
          ) return current;
          const memberActionsInFlight = new Set(current.memberActionsInFlight);
          memberActionsInFlight.delete(adminUserId);
          return Object.assign({}, current, {
            memberActionsInFlight,
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
      const settingsSessionId = state.settingsSessionId;
      const memberActionRequestId = (state.memberActionRequestIds[adminUserId] ?? 0) + 1;
      setState((current) => {
        if (
          current.type !== "settings"
          || current.projectId !== projectId
          || current.settingsSessionId !== settingsSessionId
        ) return current;
        const memberActionsInFlight = new Set(current.memberActionsInFlight);
        memberActionsInFlight.add(adminUserId);
        return Object.assign({}, current, {
          memberActionRequestIds: { ...current.memberActionRequestIds, [adminUserId]: memberActionRequestId },
          memberActionsInFlight,
          memberActionError: undefined,
          memberActionSavedMessage: undefined,
        });
      });

      try {
        await removeProjectMember(projectId, adminUserId, csrfToken);
        setState((current) => {
          if (
            current.type !== "settings"
            || current.projectId !== projectId
            || current.settingsSessionId !== settingsSessionId
            || current.memberActionRequestIds[adminUserId] !== memberActionRequestId
          ) return current;
          const memberActionsInFlight = new Set(current.memberActionsInFlight);
          memberActionsInFlight.delete(adminUserId);
          return Object.assign({}, current, {
            members: current.members.filter((member) => member.adminUserId !== adminUserId),
            memberActionsInFlight,
            memberActionError: undefined,
            memberActionSavedMessage: "멤버를 제거했습니다.",
          });
        });
      } catch (error) {
        setState((current) => {
          if (
            current.type !== "settings"
            || current.projectId !== projectId
            || current.settingsSessionId !== settingsSessionId
            || current.memberActionRequestIds[adminUserId] !== memberActionRequestId
          ) return current;
          const memberActionsInFlight = new Set(current.memberActionsInFlight);
          memberActionsInFlight.delete(adminUserId);
          return Object.assign({}, current, {
            memberActionsInFlight,
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
        memberCandidates={state.memberCandidates}
        memberCandidateSearchLoading={state.memberCandidateSearchLoading}
        memberCandidateSearchError={state.memberCandidateSearchError}
        selectedMemberCandidate={state.selectedMemberCandidate}
        onSearchMemberCandidates={handleSearchMemberCandidates}
        onSelectMemberCandidate={handleSelectMemberCandidate}
        memberActionsInFlight={state.memberActionsInFlight}
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
            settingsSessionId: state.settingsSessionId,
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
    const settingsSessionId = state.settingsSessionId;

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
