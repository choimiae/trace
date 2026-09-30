import type { SessionResponse } from "../api.js";
import { SessionTable } from "../components/SessionTable.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

export type ProjectOption = {
  projectId: string;
};

export function DashboardPage({
  userEmail,
  projects = [],
  projectId = "",
  onSelectProject = () => {},
  settingsError,
  onLogout,
  onCreateProject,
  onShowInstall,
  onShowSettings,
  onShowPageStats = () => {},
  sessions = [],
  onSelectSession = () => {},
  onReplaySession = () => {},
}: {
  userEmail: string;
  projects: ProjectOption[];
  projectId: string;
  onSelectProject: (projectId: string) => void;
  settingsError?: string | undefined;
  onLogout: () => void;
  onCreateProject: () => void;
  onShowInstall: () => void;
  onShowSettings: () => void;
  onShowPageStats?: () => void;
  sessions?: SessionResponse[];
  onSelectSession?: (sessionId: string) => void;
  onReplaySession?: (sessionId: string) => void;
}) {
  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>세션</h1>
        </div>
        <div className="header-actions">
          <label className="project-switcher">
            <span>프로젝트</span>
            <select value={projectId} onChange={(event) => onSelectProject(event.currentTarget.value)}>
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectId}
                </option>
              ))}
            </select>
          </label>
          <span className="user-email">{userEmail}</span>
          <Button onClick={onCreateProject}>새 프로젝트</Button>
          <Button onClick={onShowSettings}>프로젝트 설정</Button>
          <Button onClick={onShowPageStats}>페이지 통계</Button>
          <Button onClick={onShowInstall}>설치 안내</Button>
          <Button onClick={onLogout}>로그아웃</Button>
        </div>
      </header>
      {settingsError ? (
        <p className="dashboard-notice" role="alert">
          {settingsError}
        </p>
      ) : null}
      <Card as="section" className="sessions-panel">
        <SessionTable sessions={sessions} onSelectSession={onSelectSession} onReplaySession={onReplaySession} />
      </Card>
    </main>
  );
}
