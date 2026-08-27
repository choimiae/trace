import type { DashboardSummary, Issue } from "@trace/shared";
import { useEffect, useState } from "react";
import { ApiError, createProject, getAuthMe, getDashboardData, logout } from "./api.js";
import { API_BASE_URL } from "./config.js";
import { readSelectedProjectId, writeSelectedProjectId } from "./storage.js";
import { CreateProjectPage } from "./pages/CreateProjectPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { InstallPage } from "./pages/InstallPage.js";
import { IssueDetailPage } from "./pages/IssueDetailPage.js";
import { Button } from "./ui/Button.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles.css";

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
      projectId: string;
      userEmail: string;
      csrfToken: string;
    };

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
            projectId,
            userEmail: auth.user.email,
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

  if (state.type === "loading") return <main className="app-shell">불러오는 중</main>;

  if (state.type === "login") {
    return (
      <main className="app-shell auth-state">
        <p className="eyebrow">Trace 관리자</p>
        <h1>관리자 로그인이 필요합니다.</h1>
        <Button
          variant="primary"
          onClick={() => {
            window.location.href = `${API_BASE_URL}/auth/google/start`;
          }}
        >
          Google로 로그인
        </Button>
      </main>
    );
  }

  if (state.type === "forbidden") {
    return <AppMessage title="접근 권한이 없습니다." />;
  }

  if (state.type === "create-project") {
    const handleCreate = async (input: { name: string; allowedDomains: string[] }) => {
      try {
        const project = await createProject(input, state.csrfToken);
        writeSelectedProjectId(project.projectId);
        setState({ type: "install", projectId: project.projectId, eventsSeen: 0 });
      } catch (error) {
        setState({
          type: "create-project",
          csrfToken: state.csrfToken,
          createError: error instanceof ApiError ? error.message : "프로젝트를 만들지 못했습니다.",
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
      <main className="app-shell auth-state">
        <p className="eyebrow">Trace 관리자</p>
        <h1>연결할 수 없습니다.</h1>
        <p>잠시 후 다시 시도해주세요.</p>
        <Button variant="primary" onClick={() => setReloadKey((key) => key + 1)}>
          다시 시도
        </Button>
      </main>
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

  return (
    <>
      <DashboardPage
        summary={state.data.summary}
        issues={state.data.issues}
        userEmail={state.userEmail}
        onLogout={() => { void handleLogout(); }}
        onSelectIssue={setSelectedIssue}
        onShowInstall={() =>
          setState({
            type: "install",
            projectId: state.projectId,
            eventsSeen: state.data.summary.totalEventsCount,
          })
        }
      />
      {selectedIssue ? <IssueDetailPage issue={selectedIssue} onClose={() => setSelectedIssue(undefined)} /> : null}
    </>
  );
}

function AppMessage({ title }: { title: string }) {
  return (
    <main className="app-shell auth-state">
      <p className="eyebrow">Trace 관리자</p>
      <h1>{title}</h1>
    </main>
  );
}

function buildSnippet(projectId: string): string {
  return `<script src="${API_BASE_URL}/trace.js" data-project-id="${projectId}"></script>`;
}
