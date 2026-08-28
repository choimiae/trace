# Project Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 헤더에 항상 노출되는 프로젝트 select를 추가하고, 선택한 프로젝트 기준으로 대시보드·설정·설치 안내가 동작하게 한다.

**Architecture:** 기존 `AppState` 기반 화면 전환을 유지한다. `/auth/me.projects` 목록을 `ready`와 설정 관련 상태에 보존하고, `DashboardPage`는 native `<select>`를 렌더링하는 표시 컴포넌트로 둔다. 프로젝트 전환은 `App`에서 localStorage 저장, issue 상세 닫기, dashboard 재조회, 기존 오류 화면 매핑을 처리한다.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, 기존 Admin UI CSS tokens.

## Global Constraints

- 기본 언어와 사용자-facing copy는 한국어로 작성한다.
- native `<select>`를 사용하고 커스텀 드롭다운 컴포넌트는 만들지 않는다.
- 프로젝트가 1개여도 select를 항상 노출한다.
- 프로젝트 이름 표시를 위한 API 확장은 하지 않고 `projectId`를 표시한다.
- 설정 화면 안에는 프로젝트 전환 UI를 넣지 않는다.
- 라우터나 전역 상태 라이브러리는 도입하지 않는다.
- 전환 중 `401`은 로그인 화면, `403`은 접근 권한 없음 화면, 기타 오류는 연결 실패 화면으로 매핑한다.
- `npm test`가 최종 검증 명령이다.

---

## File Structure

- Modify: `apps/admin/src/pages/DashboardPage.tsx`
  - 대시보드 헤더에 프로젝트 select를 렌더링한다.
  - `ProjectOption` 타입을 export해서 `App`과 테스트가 같은 props shape를 사용하게 한다.
- Modify: `apps/admin/src/pages/DashboardPage.test.tsx`
  - select 상시 노출, 현재 선택값, 변경 콜백을 검증한다.
- Modify: `apps/admin/src/pages/pages.css`
  - `.project-switcher`와 내부 `select` 스타일을 추가한다.
- Modify: `apps/admin/src/App.tsx`
  - `/auth/me.projects`를 상태에 보존한다.
  - 초기 선택과 프로젝트 전환에서 같은 프로젝트 목록을 유지한다.
  - `handleSelectProject`를 추가한다.
  - 설정/설치 안내가 선택된 프로젝트 ID를 계속 사용하도록 상태 전이에 `projects`를 전달한다.
- Modify: `apps/admin/src/App.test.tsx`
  - 초기 선택, 저장값 fallback, 전환, localStorage 저장, downstream 설정/설치, 오류 매핑을 검증한다.

---

### Task 1: DashboardPage 프로젝트 Select

**Files:**
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.test.tsx`
- Modify: `apps/admin/src/pages/pages.css`

**Interfaces:**
- Produces:
  - `export type ProjectOption = { projectId: string; role: "owner" | "admin" | "viewer" };`
  - `DashboardPage` props:
    - `projects: ProjectOption[]`
    - `projectId: string`
    - `onSelectProject: (projectId: string) => void`

- [ ] **Step 1: Write failing DashboardPage tests**

Modify `apps/admin/src/pages/DashboardPage.test.tsx`.

Add `fireEvent` to the import:

```ts
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
```

Define reusable projects near `summary`:

```ts
const projects = [
  { projectId: "proj_demo", role: "owner" as const },
  { projectId: "proj_second", role: "viewer" as const },
];
```

Update the existing `DashboardPage` renders to pass the new required props:

```tsx
projects={[projects[0]]}
projectId="proj_demo"
onSelectProject={vi.fn()}
```

Add these tests inside the existing `DashboardPage` describe block:

```tsx
it("프로젝트가 하나여도 프로젝트 select를 보여준다", () => {
  render(
    <DashboardPage
      summary={summary}
      issues={[]}
      userEmail="admin@example.com"
      projects={[projects[0]]}
      projectId="proj_demo"
      onSelectProject={vi.fn()}
      onLogout={vi.fn()}
      onShowInstall={vi.fn()}
      onShowSettings={vi.fn()}
    />,
  );

  const select = screen.getByLabelText("프로젝트");
  expect(select).toBeInTheDocument();
  expect(select).toHaveValue("proj_demo");
  expect(screen.getByRole("option", { name: "proj_demo" })).toBeInTheDocument();
});

it("프로젝트 선택이 바뀌면 선택 콜백을 호출한다", () => {
  const onSelectProject = vi.fn();
  render(
    <DashboardPage
      summary={summary}
      issues={[]}
      userEmail="admin@example.com"
      projects={projects}
      projectId="proj_demo"
      onSelectProject={onSelectProject}
      onLogout={vi.fn()}
      onShowInstall={vi.fn()}
      onShowSettings={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("프로젝트"), { target: { value: "proj_second" } });

  expect(onSelectProject).toHaveBeenCalledWith("proj_second");
});
```

- [ ] **Step 2: Run DashboardPage tests and verify they fail**

Run:

```bash
npm run test --workspace @trace/admin -- src/pages/DashboardPage.test.tsx
```

Expected: FAIL because `DashboardPage` does not accept `projects`, `projectId`, or `onSelectProject`, and no select labeled `프로젝트` exists.

- [ ] **Step 3: Implement DashboardPage props and select**

Modify `apps/admin/src/pages/DashboardPage.tsx`.

Add the exported type after chart imports:

```ts
export type ProjectOption = {
  projectId: string;
  role: "owner" | "admin" | "viewer";
};
```

Add props in the function destructuring:

```ts
  projects,
  projectId,
  onSelectProject,
```

Add prop types:

```ts
  projects: ProjectOption[];
  projectId: string;
  onSelectProject: (projectId: string) => void;
```

Render the select inside `.header-actions`, before the user email:

```tsx
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
```

- [ ] **Step 4: Add select styles**

Modify `apps/admin/src/pages/pages.css`.

Add after `.user-email`:

```css
.project-switcher {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.project-switcher select {
  min-width: 150px;
  max-width: 220px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  padding: 7px 28px 7px 10px;
  color: var(--ink);
  font: inherit;
}
```

- [ ] **Step 5: Run DashboardPage tests and verify they pass**

Run:

```bash
npm run test --workspace @trace/admin -- src/pages/DashboardPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/DashboardPage.test.tsx apps/admin/src/pages/pages.css
git commit -m "관리자: 대시보드 프로젝트 선택 UI 추가"
```

---

### Task 2: App 초기 선택과 프로젝트 목록 보존

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `ProjectOption` from `./pages/DashboardPage.js`
  - `DashboardPage` props from Task 1
- Produces:
  - `ready`, `settings-not-found`, `settings` states carry `projects: ProjectOption[]`
  - Initial load stores and passes the selected project list to `DashboardPage`

- [ ] **Step 1: Write failing App tests for initial selection**

Modify `apps/admin/src/App.test.tsx`.

Add this helper after `baseSummary`:

```ts
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
```

Add this helper after `dashboardDataFor`:

```ts
function mockDashboardDataByProject() {
  api.getDashboardData.mockImplementation((projectId: string) => Promise.resolve(dashboardDataFor(projectId)));
}
```

Add a new describe block before the `App 프로젝트 설정` describe block:

```tsx
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
```

- [ ] **Step 2: Run App tests and verify they fail**

Run:

```bash
npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: FAIL because `App` does not pass project select props to `DashboardPage`.

- [ ] **Step 3: Add ProjectOption and state fields**

Modify `apps/admin/src/App.tsx`.

Change the DashboardPage import:

```ts
import { DashboardPage, type ProjectOption } from "./pages/DashboardPage.js";
```

Add `projects: ProjectOption[]` to these states:

```ts
  | {
      type: "ready";
      data: { summary: DashboardSummary; issues: Issue[] };
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      csrfToken: string;
      settingsError?: string | undefined;
    }
  | {
      type: "settings-not-found";
      dashboardData: { summary: DashboardSummary; issues: Issue[] };
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      csrfToken: string;
    }
  | {
      type: "settings";
      project: ProjectSettingsResponse;
      dashboardData: { summary: DashboardSummary; issues: Issue[] };
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      csrfToken: string;
      saving?: boolean;
      error?: string | undefined;
      savedMessage?: string | undefined;
    };
```

- [ ] **Step 4: Preserve projects during initial load and existing state transitions**

In the initial `load()` success branch, add `projects: auth.projects`:

```ts
setState({
  type: "ready",
  data,
  projects: auth.projects,
  projectId,
  userEmail: auth.user.email,
  csrfToken: auth.csrfToken,
});
```

In the `settings-not-found` back action, add `projects: state.projects`:

```ts
setState({
  type: "ready",
  data: state.dashboardData,
  projects: state.projects,
  projectId: state.projectId,
  userEmail: state.userEmail,
  csrfToken: state.csrfToken,
});
```

In `handleShowSettings`, add `projects: current.projects` to the `settings` state:

```ts
{
  type: "settings",
  project,
  dashboardData: current.data,
  projects: current.projects,
  projectId: current.projectId,
  userEmail: current.userEmail,
  csrfToken: current.csrfToken,
}
```

In the `404` settings-not-found state, add `projects: current.projects`:

```ts
{
  type: "settings-not-found",
  dashboardData: current.data,
  projects: current.projects,
  projectId: current.projectId,
  userEmail: current.userEmail,
  csrfToken: current.csrfToken,
}
```

In `ProjectSettingsPage` `onBack`, add `projects: state.projects`:

```ts
setState({
  type: "ready",
  data: state.dashboardData,
  projects: state.projects,
  projectId: state.projectId,
  userEmail: state.userEmail,
  csrfToken: state.csrfToken,
})
```

- [ ] **Step 5: Pass project props to DashboardPage**

In the final `DashboardPage` render, add:

```tsx
projects={state.projects}
projectId={state.projectId}
onSelectProject={() => {}}
```

This temporary no-op callback is allowed only inside this intermediate task because Task 3 replaces it before the feature is complete. Commit Task 2 only after the tests in this task pass; Task 3 must be completed before merging the feature branch.

- [ ] **Step 6: Run App tests and verify they pass**

Run:

```bash
npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: PASS for the initial project select tests and existing App tests.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "관리자: 선택 프로젝트 목록을 앱 상태에 보존"
```

---

### Task 3: Project Switching Behavior

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `DashboardPage` select emits `onSelectProject(projectId: string)`
  - `ready.projects` from Task 2
- Produces:
  - `handleSelectProject(projectId: string): Promise<void>`
  - Project switch reloads dashboard, stores selected ID, closes issue detail, and maps errors.

- [ ] **Step 1: Write failing switch success tests**

Modify `apps/admin/src/App.test.tsx`.

Add these tests inside a new describe block after the `App 프로젝트 전환 초기 상태` describe block:

```tsx
describe("App 프로젝트 전환 동작", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockDashboardDataByProject();
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
    expect(await screen.findByText("같은 버튼을 반복 클릭했습니다.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("프로젝트"), { target: { value: "proj_second" } });

    expect(await screen.findByText("proj_second 설정 화면에서 반복 클릭")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run App tests and verify they fail**

Run:

```bash
npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: FAIL because `onSelectProject` still does nothing.

- [ ] **Step 3: Implement handleSelectProject**

Modify `apps/admin/src/App.tsx`.

Add this handler before the final `return` that renders `DashboardPage`:

```ts
  const handleSelectProject = async (nextProjectId: string) => {
    if (state.type !== "ready" || nextProjectId === state.projectId) return;

    const projects = state.projects;
    const userEmail = state.userEmail;
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
```

Replace the intermediate callback from Task 2:

```tsx
onSelectProject={(projectId) => { void handleSelectProject(projectId); }}
```

- [ ] **Step 4: Run App tests and verify switch success passes**

Run:

```bash
npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: PASS for switch success and issue detail closing tests.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "관리자: 프로젝트 전환으로 대시보드 다시 조회"
```

---

### Task 4: Downstream Screens and Error Mapping

**Files:**
- Modify: `apps/admin/src/App.test.tsx`
- Modify: `apps/admin/src/App.tsx` only if tests reveal a missing state field or stale project ID bug.

**Interfaces:**
- Consumes:
  - `handleSelectProject(projectId: string)` from Task 3
  - `state.projectId` drives install snippet and settings fetch
- Produces:
  - Verified install/settings use selected project ID after switching
  - Verified switch errors map to existing status screens

- [ ] **Step 1: Write failing downstream tests**

Add these tests to the `App 프로젝트 전환 동작` describe block:

```tsx
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
```

- [ ] **Step 2: Write failing error mapping tests**

Add these tests to the `App 프로젝트 전환 동작` describe block:

```tsx
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
```

- [ ] **Step 3: Run App tests and inspect failures**

Run:

```bash
npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: PASS if Tasks 2 and 3 preserved `projects` and `projectId` correctly. If a test fails, fix only the stale state field or stale `projectId` indicated by the assertion.

- [ ] **Step 4: Run all admin tests**

Run:

```bash
npm run test --workspace @trace/admin
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "관리자: 프로젝트 전환 후 화면 동작 검증"
```

---

### Task 5: Final Verification

**Files:**
- No code changes expected.

**Interfaces:**
- Consumes:
  - All previous tasks.
- Produces:
  - Verified feature branch ready for integration.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run git diff check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat main HEAD
```

Expected changed areas:

```text
docs/superpowers/specs/2026-08-28-project-switcher-design.md
docs/superpowers/plans/2026-08-28-project-switcher-implementation.md
apps/admin/src/App.tsx
apps/admin/src/App.test.tsx
apps/admin/src/pages/DashboardPage.tsx
apps/admin/src/pages/DashboardPage.test.tsx
apps/admin/src/pages/pages.css
```

- [ ] **Step 5: Commit any final verification-only fixes**

If Step 1-4 require a fix, make the smallest correction and commit it:

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/DashboardPage.test.tsx apps/admin/src/pages/pages.css
git commit -m "관리자: 프로젝트 전환 검증 정리"
```

If there are no changes after verification, do not create an empty commit.

## Self-Review

- Spec coverage: 대시보드 헤더 select, 단일 프로젝트 상시 노출, projectId 표시, localStorage 저장, dashboard 재조회, 설정/설치 downstream, 오류 매핑, 테스트 요구가 Tasks 1-5에 매핑되어 있다.
- Forbidden-pattern scan: 금지된 빈칸 표시 문구와 모호한 구현 지시를 제거했다. Task 2의 intermediate no-op callback은 같은 계획 안에서 Task 3이 제거하는 명시적 중간 상태로만 허용한다.
- Type consistency: `ProjectOption`, `projects`, `projectId`, `onSelectProject` 이름은 Task 1에서 만들고 Tasks 2-4에서 같은 이름으로 사용한다.
