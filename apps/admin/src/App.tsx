import type { DashboardSummary, Issue } from "@trace/shared";
import { useEffect, useState } from "react";
import { ApiError, getAuthMe, getDashboardData, logout } from "./api.js";
import { API_BASE_URL } from "./config.js";
import { readSelectedProjectId, writeSelectedProjectId } from "./storage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { IssueDetailPage } from "./pages/IssueDetailPage.js";
import "./styles.css";

type AppState =
  | { type: "loading" }
  | { type: "login" }
  | { type: "forbidden" }
  | { type: "network" }
  | { type: "empty-projects" }
  | {
      type: "ready";
      data: { summary: DashboardSummary; issues: Issue[] };
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
          if (active) setState({ type: "empty-projects" });
          return;
        }

        writeSelectedProjectId(projectId);

        const data = await getDashboardData(projectId);
        if (active) {
          setState({ type: "ready", data, userEmail: auth.user.email, csrfToken: auth.csrfToken });
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

  if (state.type === "loading") return <main className="app-shell">불러오는 중</main>;

  if (state.type === "login") {
    return (
      <main className="app-shell auth-state">
        <p className="eyebrow">Trace 관리자</p>
        <h1>관리자 로그인이 필요합니다.</h1>
        <button type="button" className="primary-button" onClick={() => { window.location.href = `${API_BASE_URL}/auth/google/start`; }}>
          Google로 로그인
        </button>
      </main>
    );
  }

  if (state.type === "forbidden") {
    return <AppMessage title="접근 권한이 없습니다." />;
  }

  if (state.type === "empty-projects") {
    return <AppMessage title="연결된 프로젝트가 없습니다." />;
  }

  if (state.type === "network") {
    return (
      <main className="app-shell auth-state">
        <p className="eyebrow">Trace 관리자</p>
        <h1>연결할 수 없습니다.</h1>
        <p>잠시 후 다시 시도해주세요.</p>
        <button type="button" className="primary-button" onClick={() => setReloadKey((key) => key + 1)}>다시 시도</button>
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
