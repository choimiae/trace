# Project Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 앱에서 현재 프로젝트의 이름과 허용 도메인을 조회하고 수정할 수 있는 설정 화면을 만든다.

**Architecture:** 기존 `AppState` 기반 화면 전환을 유지하고 `settings` 상태를 추가한다. API는 관리자 BFF(`apps/api/src/routes/admin-proxy.ts`)에 프로젝트 상세 조회와 수정 엔드포인트를 추가하고, 저장은 `TraceStore.updateProject()` 계약으로 memory/sqlite 양쪽에 구현한다.

**Tech Stack:** TypeScript, React, Fastify, Zod, Vitest, Testing Library, better-sqlite3.

## Global Constraints

- 프로젝트 삭제, 멤버 초대/제거/역할 변경, 프로젝트 전환 드롭다운은 구현하지 않는다.
- 수정 가능 필드는 `name`과 `allowedDomains` 두 개뿐이다.
- `owner`와 `admin`은 조회/수정 가능하고, `viewer`는 조회만 가능하다.
- 프로젝트 멤버가 아닌 사용자는 조회/수정 모두 `403 project_access_denied`이다.
- 허용 도메인은 프로젝트 생성과 동일하게 `new URL(domain).origin` 기준으로 정규화하고 중복 제거한다.
- 저장 성공 시 audit log action은 `project.updated`이고 metadata는 `{ before: { name, allowedDomains }, after: { name, allowedDomains } }`이다.
- 별도 라우터는 도입하지 않는다.
- 제품 카피는 한국어로 쓴다.
- 구현 중 기존 사용자 변경을 되돌리지 않는다.
- 각 태스크 완료 시 관련 테스트를 통과시키고 커밋한다.

---

## File Structure

- `apps/api/src/store/types.ts`: `UpdateProjectInput`과 `TraceStore.updateProject()` 계약을 추가한다.
- `apps/api/src/store/store-contract.test.ts`: memory/sqlite 공통 프로젝트 수정 계약을 추가한다.
- `apps/api/src/store/memory-store.ts`: in-memory 프로젝트 수정 구현을 추가한다.
- `apps/api/src/store/sqlite-store.ts`: SQLite `projects` 행 수정 구현을 추가한다.
- `apps/api/src/routes/admin.ts`: 생성/수정 공통 프로젝트 입력 schema를 정리한다.
- `apps/api/src/routes/admin-proxy.ts`: `GET /admin/api/projects/:projectId`, `PATCH /admin/api/projects/:projectId`, 역할 검사 helper를 추가한다.
- `apps/api/src/routes/admin.test.ts`: 프로젝트 설정 조회/수정 권한과 audit 테스트를 추가한다.
- `apps/admin/src/api.ts`: `ProjectSettingsResponse`, `getProjectSettings()`, `updateProjectSettings()`를 추가한다.
- `apps/admin/src/ui/Field.tsx`: `multiline`과 `disabled`를 지원한다.
- `apps/admin/src/ui/Field.test.tsx`: textarea/disabled 접근성 회귀 테스트를 추가한다.
- `apps/admin/src/pages/ProjectSettingsPage.tsx`: 설정 화면을 추가한다.
- `apps/admin/src/pages/ProjectSettingsPage.test.tsx`: 설정 화면 단위 테스트를 추가한다.
- `apps/admin/src/pages/DashboardPage.tsx`: 설정 화면 진입 버튼을 추가한다.
- `apps/admin/src/pages/DashboardPage.test.tsx`: 새 필수 prop과 설정 버튼 렌더링을 검증한다.
- `apps/admin/src/App.tsx`: `settings` 상태와 조회/저장 전환을 연결한다.
- `apps/admin/src/App.test.tsx`: 대시보드에서 설정 이동, 저장 성공, viewer 읽기 전용 흐름을 검증한다.
- `apps/admin/src/App.loading.test.tsx`: `App`의 새 API import를 mock에 추가한다.
- `apps/admin/src/pages/pages.css`: 설정 화면 레이아웃 스타일을 추가한다.

---

### Task 1: Store Update Contract

**Files:**
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/store-contract.test.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`

**Interfaces:**
- Consumes: existing `CreateProjectInput`, `ProjectRecord`, `TraceStore`.
- Produces:
  - `UpdateProjectInput`: `{ name: string; allowedDomains: string[] }`
  - `TraceStore.updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined>`

- [ ] **Step 1: Add the failing store contract tests**

In `apps/api/src/store/store-contract.test.ts`, add these tests inside `describeTraceStoreContract(...)`.

```ts
    it("프로젝트 이름과 허용 도메인을 수정한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Old",
        allowedDomains: ["https://old.example.com"],
      });

      const updated = await store.updateProject(project.projectId, {
        name: "New",
        allowedDomains: ["https://new.example.com", "https://app.example.com"],
      });

      expect(updated).toMatchObject({
        projectId: project.projectId,
        name: "New",
        allowedDomains: ["https://new.example.com", "https://app.example.com"],
        privacyConfig: project.privacyConfig,
        createdAt: project.createdAt,
      });
      expect(await store.getProject(project.projectId)).toEqual(updated);
    });

    it("없는 프로젝트 수정은 undefined를 반환한다", async () => {
      const store = open();

      await expect(store.updateProject("proj_missing", {
        name: "Missing",
        allowedDomains: ["https://missing.example.com"],
      })).resolves.toBeUndefined();
    });
```

- [ ] **Step 2: Run the store contract test and verify it fails**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: FAIL because `updateProject` does not exist on `TraceStore`.

- [ ] **Step 3: Add the store interface**

In `apps/api/src/store/types.ts`, add `UpdateProjectInput` after `CreateProjectInput`.

```ts
export interface UpdateProjectInput {
  name: string;
  allowedDomains: string[];
}
```

Add this method after `getProject(...)` in `TraceStore`.

```ts
  updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined>;
```

- [ ] **Step 4: Implement MemoryStore**

In `apps/api/src/store/memory-store.ts`, import `UpdateProjectInput`.

```ts
  UpdateProjectInput,
```

Add this method after `getProject(...)`.

```ts
  async updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined> {
    const existing = this.projects.get(projectId);
    if (!existing) return undefined;

    const updated: ProjectRecord = {
      ...existing,
      name: input.name,
      allowedDomains: input.allowedDomains,
    };
    this.projects.set(projectId, updated);
    return updated;
  }
```

- [ ] **Step 5: Implement SqliteStore**

In `apps/api/src/store/sqlite-store.ts`, import `UpdateProjectInput`.

```ts
  UpdateProjectInput,
```

Add this method after `getProject(...)`.

```ts
  async updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined> {
    const existing = await this.getProject(projectId);
    if (!existing) return undefined;

    this.db
      .prepare(`UPDATE projects SET name = ?, allowed_domains = ? WHERE project_id = ?`)
      .run(input.name, JSON.stringify(input.allowedDomains), projectId);

    return {
      ...existing,
      name: input.name,
      allowedDomains: input.allowedDomains,
    };
  }
```

- [ ] **Step 6: Run the store contract test and verify it passes**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/store/types.ts apps/api/src/store/store-contract.test.ts apps/api/src/store/memory-store.ts apps/api/src/store/sqlite-store.ts
git commit -m "관리자: 프로젝트 수정 store 계약 추가"
```

---

### Task 2: Project Settings API Routes

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Modify: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes:
  - `TraceStore.updateProject(projectId, input)`
  - `ProjectMembershipRecord.role`
- Produces:
  - `projectSettingsSchema`: Zod schema for `{ name, allowedDomains }`
  - `GET /admin/api/projects/:projectId`
  - `PATCH /admin/api/projects/:projectId`

- [ ] **Step 1: Add API route tests**

In `apps/api/src/routes/admin.test.ts`, add these tests inside `describe("admin bff routes", ...)`.

```ts
  it("returns project settings with the signed-in member role", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "admin",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projectId: project.projectId,
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
      role: "admin",
    });
  });

  it("returns 403 and audits when project settings are requested by a non-member", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Private",
      allowedDomains: ["https://private.example.com"],
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_access_denied" });
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "project_settings" },
      }),
    ]));
  });

  it("lets an owner update project settings and audits the change", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({
      name: "Old",
      allowedDomains: ["https://old.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: {
        name: "New",
        allowedDomains: ["https://new.example.com/path", "https://new.example.com"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projectId: project.projectId,
      name: "New",
      allowedDomains: ["https://new.example.com"],
      role: "owner",
    });
    expect(await store.getProject(project.projectId)).toMatchObject({
      name: "New",
      allowedDomains: ["https://new.example.com"],
    });
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.updated",
        projectId: project.projectId,
        metadata: {
          before: { name: "Old", allowedDomains: ["https://old.example.com"] },
          after: { name: "New", allowedDomains: ["https://new.example.com"] },
        },
      }),
    ]));
  });

  it("lets an admin update project settings", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({
      name: "Old",
      allowedDomains: ["https://old.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "admin",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: {
        name: "Admin Updated",
        allowedDomains: ["https://admin.example.com"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Admin Updated",
      allowedDomains: ["https://admin.example.com"],
      role: "admin",
    });
  });

  it("rejects project settings updates from a viewer", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({
      name: "Viewer Project",
      allowedDomains: ["https://viewer.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "viewer",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: {
        name: "Blocked",
        allowedDomains: ["https://blocked.example.com"],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_role_forbidden" });
    expect(await store.getProject(project.projectId)).toMatchObject({
      name: "Viewer Project",
      allowedDomains: ["https://viewer.example.com"],
    });
  });

  it("rejects invalid project settings updates", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const responses = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/admin/api/projects/${project.projectId}`,
        headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
        payload: { name: "", allowedDomains: ["https://demo.example.com"] },
      }),
      app.inject({
        method: "PATCH",
        url: `/admin/api/projects/${project.projectId}`,
        headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
        payload: { name: "Demo", allowedDomains: [] },
      }),
      app.inject({
        method: "PATCH",
        url: `/admin/api/projects/${project.projectId}`,
        headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
        payload: { name: "Demo", allowedDomains: ["localhost"] },
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400]);
  });
```

- [ ] **Step 2: Run the API route test and verify it fails**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts
```

Expected: FAIL because the new routes do not exist.

- [ ] **Step 3: Share the project settings schema**

In `apps/api/src/routes/admin.ts`, replace `createProjectSchema` with a shared schema and export both names.

```ts
export const projectSettingsSchema = z.object({
  name: z.string().trim().min(1),
  allowedDomains: z.array(z.string().url()).min(1).transform((domains) => Array.from(new Set(
    domains.map((domain) => new URL(domain).origin),
  ))),
});

export const createProjectSchema = projectSettingsSchema;
export const updateProjectSchema = projectSettingsSchema;
```

- [ ] **Step 4: Add project settings routes and role helpers**

In `apps/api/src/routes/admin-proxy.ts`, change the imports.

```ts
import { createProjectSchema, updateProjectSchema } from "./admin.js";
import type { ProjectMembershipRecord, ProjectRecord, TraceStore } from "../store/types.js";
```

Add this route before `/admin/api/projects/:projectId/summary`.

```ts
  app.get("/admin/api/projects/:projectId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_settings");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    return toProjectSettingsResponse(access.project, access.membership.role);
  });
```

Add this route after it.

```ts
  app.patch("/admin/api/projects/:projectId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_settings");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
    if (access.membership.role === "viewer") {
      return reply.code(403).send({ error: "project_role_forbidden" });
    }

    const parsed = updateProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_project_settings" });

    const input = parsed.data;
    const updated = await options.store.updateProject(projectId, input);
    if (!updated) return reply.code(404).send({ error: "project_not_found" });

    await options.store.createAuditLog({
      adminUserId: authenticated.adminUserId,
      action: "project.updated",
      projectId,
      createdAt: new Date().toISOString(),
      metadata: {
        before: {
          name: access.project.name,
          allowedDomains: access.project.allowedDomains,
        },
        after: {
          name: updated.name,
          allowedDomains: updated.allowedDomains,
        },
      },
    });

    return toProjectSettingsResponse(updated, access.membership.role);
  });
```

Replace `getProjectAccessError(...)` with a helper that returns project and membership.

```ts
async function getProjectAccess(
  store: TraceStore,
  projectId: string,
  authenticated: AuthenticatedAdmin,
  resourceType: ProjectResourceType,
): Promise<ProjectAccess | ProjectAccessError> {
  const project = await store.getProject(projectId);
  if (!project) return { statusCode: 404, error: "project_not_found" };

  const membership = await store.getProjectMembership(projectId, authenticated.adminUserId);
  if (!membership) {
    await auditProjectAccessDenied(store, projectId, authenticated, resourceType);
    return { statusCode: 403, error: "project_access_denied" };
  }

  return { project, membership };
}
```

Keep existing summary/issues/timeline routes working by changing their access check to:

```ts
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_summary");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
```

Add these types near `ProjectAccessError`.

```ts
type ProjectAccess = {
  project: ProjectRecord;
  membership: ProjectMembershipRecord;
};
```

Replace `ProjectResourceType` with:

```ts
type ProjectResourceType =
  | "project_settings"
  | "project_summary"
  | "project_issues"
  | "issue_detail"
  | "session_timeline";
```

Add this response helper near `firstHeaderValue(...)`.

```ts
function toProjectSettingsResponse(
  project: NonNullable<Awaited<ReturnType<TraceStore["getProject"]>>>,
  role: NonNullable<Awaited<ReturnType<TraceStore["getProjectMembership"]>>>["role"],
) {
  return {
    projectId: project.projectId,
    name: project.name,
    allowedDomains: project.allowedDomains,
    role,
  };
}
```

- [ ] **Step 5: Convert project creation schema parsing to a stable 400 response**

In the existing `POST /admin/api/projects` route, replace direct `.parse(...)` with `safeParse(...)` so project creation keeps returning the existing `invalid_allowed_domains` error.

```ts
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_allowed_domains" });
    const project = await options.store.createProject(parsed.data);
```

- [ ] **Step 6: Run API route tests and verify they pass**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.test.ts
git commit -m "관리자: 프로젝트 설정 API 추가"
```

---

### Task 3: Field Primitive Multiline And Disabled States

**Files:**
- Modify: `apps/admin/src/ui/Field.tsx`
- Modify: `apps/admin/src/ui/Field.test.tsx`
- Modify: `apps/admin/src/ui/Field.css`

**Interfaces:**
- Consumes: existing `Field({ id, label, value, onChange, placeholder, hint, error })`.
- Produces: `Field` supports `multiline?: boolean`, `disabled?: boolean`, and `rows?: number`.

- [ ] **Step 1: Add failing Field tests**

In `apps/admin/src/ui/Field.test.tsx`, update the Testing Library import to include `fireEvent`.

```ts
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
```

Then add:

```tsx
  it("renders a textarea when multiline is true", () => {
    const onChange = vi.fn();

    render(
      <Field
        id="allowed-domains"
        label="허용 도메인"
        value={"https://example.com\nhttps://app.example.com"}
        onChange={onChange}
        multiline
        rows={4}
      />,
    );

    const field = screen.getByLabelText("허용 도메인");
    expect(field.tagName).toBe("TEXTAREA");
    fireEvent.change(field, { target: { value: "https://new.example.com" } });
    expect(onChange).toHaveBeenCalledWith("https://new.example.com");
  });

  it("passes disabled to the rendered control", () => {
    render(
      <Field
        id="project-name"
        label="프로젝트 이름"
        value="Demo"
        onChange={() => undefined}
        disabled
      />,
    );

    expect(screen.getByLabelText("프로젝트 이름")).toBeDisabled();
  });
```

- [ ] **Step 2: Run Field tests and verify they fail**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/ui/Field.test.tsx
```

Expected: FAIL because `Field` does not support `multiline` or `disabled`.

- [ ] **Step 3: Extend Field props and rendering**

In `apps/admin/src/ui/Field.tsx`, add props.

```ts
  multiline = false,
  rows = 4,
  disabled = false,
```

Extend the prop type.

```ts
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
```

Replace the `<input ... />` block with:

```tsx
      {multiline ? (
        <textarea
          id={id}
          value={value}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
```

- [ ] **Step 4: Style textarea and disabled controls**

In `apps/admin/src/ui/Field.css`, replace the existing `.field input` selector with `.field input, .field textarea` and add textarea/disabled selectors:

```css
.field input,
.field textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}

.field textarea {
  resize: vertical;
  min-height: 104px;
  line-height: 1.5;
}

.field input:disabled,
.field textarea:disabled {
  background: var(--surface-sunk);
  color: var(--ink-muted);
  cursor: not-allowed;
}
```

Preserve any existing spacing, focus, and error selectors by expanding them to include `textarea`.

- [ ] **Step 5: Run Field tests and verify they pass**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/ui/Field.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/ui/Field.tsx apps/admin/src/ui/Field.test.tsx apps/admin/src/ui/Field.css
git commit -m "관리자: Field 다중 줄 입력 상태 추가"
```

---

### Task 4: Project Settings Page Component

**Files:**
- Create: `apps/admin/src/pages/ProjectSettingsPage.tsx`
- Create: `apps/admin/src/pages/ProjectSettingsPage.test.tsx`
- Modify: `apps/admin/src/pages/pages.css`

**Interfaces:**
- Consumes:
  - `Field` with `multiline` and `disabled`
  - `Button`
  - `Card`
- Produces:
  - `ProjectSettingsPage({ project, onBack, onSave, error, savedMessage, saving })`
  - `ProjectSettingsViewModel`: `{ projectId: string; name: string; allowedDomains: string[]; role: "owner" | "admin" | "viewer" }`

- [ ] **Step 1: Add failing page tests**

Create `apps/admin/src/pages/ProjectSettingsPage.test.tsx`.

```tsx
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSettingsPage } from "./ProjectSettingsPage.js";

expect.extend(matchers);

const ownerProject = {
  projectId: "proj_demo",
  name: "Demo",
  allowedDomains: ["https://demo.example.com", "https://app.example.com"],
  role: "owner" as const,
};

describe("ProjectSettingsPage", () => {
  it("renders editable project settings for owners", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toHaveValue("Demo");
    expect(screen.getByLabelText("허용 도메인")).toHaveValue(
      "https://demo.example.com\nhttps://app.example.com",
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("submits trimmed name and line-separated domains", () => {
    const onSave = vi.fn();
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "  New Demo  " } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), {
      target: { value: "https://new.example.com\n\nhttps://app.example.com  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "New Demo",
      allowedDomains: ["https://new.example.com", "https://app.example.com"],
    });
  });

  it("disables saving when required fields are empty", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("renders viewer settings as read-only", () => {
    render(
      <ProjectSettingsPage
        project={{ ...ownerProject, role: "viewer" }}
        onBack={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByText("읽기 전용 권한입니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toBeDisabled();
    expect(screen.getByLabelText("허용 도메인")).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("shows save state messages", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={() => undefined}
        error="invalid_project_settings"
        savedMessage="저장했습니다."
      />,
    );

    expect(screen.getByText("invalid_project_settings")).toBeInTheDocument();
    expect(screen.getByText("저장했습니다.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the page test and verify it fails**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx
```

Expected: FAIL because `ProjectSettingsPage` does not exist.

- [ ] **Step 3: Implement ProjectSettingsPage**

Create `apps/admin/src/pages/ProjectSettingsPage.tsx`.

```tsx
import { useEffect, useState } from "react";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Field } from "../ui/Field.js";

export interface ProjectSettingsViewModel {
  projectId: string;
  name: string;
  allowedDomains: string[];
  role: "owner" | "admin" | "viewer";
}

export function ProjectSettingsPage({
  project,
  onBack,
  onSave,
  saving = false,
  error,
  savedMessage,
}: {
  project: ProjectSettingsViewModel;
  onBack: () => void;
  onSave: (input: { name: string; allowedDomains: string[] }) => void;
  saving?: boolean;
  error?: string | undefined;
  savedMessage?: string | undefined;
}) {
  const [name, setName] = useState(project.name);
  const [domains, setDomains] = useState(project.allowedDomains.join("\n"));
  const readOnly = project.role === "viewer";

  useEffect(() => {
    setName(project.name);
    setDomains(project.allowedDomains.join("\n"));
  }, [project.projectId, project.name, project.allowedDomains]);

  const allowedDomains = domains
    .split("\n")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
  const canSave = !readOnly && !saving && name.trim().length > 0 && allowedDomains.length > 0;

  return (
    <main className="app-shell settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>프로젝트 설정</h1>
          <p className="settings-subtitle">{project.projectId}</p>
        </div>
        <div className="header-actions">
          <span className="user-email">{roleLabel(project.role)}</span>
          <Button onClick={onBack}>대시보드로 돌아가기</Button>
        </div>
      </header>

      {readOnly ? <p className="settings-notice">읽기 전용 권한입니다.</p> : null}

      <Card as="section" className="settings-panel">
        <Field
          id="settings-project-name"
          label="프로젝트 이름"
          value={name}
          onChange={setName}
          disabled={readOnly || saving}
        />
        <Field
          id="settings-allowed-domains"
          label="허용 도메인"
          value={domains}
          onChange={setDomains}
          multiline
          rows={5}
          disabled={readOnly || saving}
          hint="한 줄에 하나의 URL을 입력합니다."
          error={error}
        />
        <div className="settings-actions">
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() => onSave({ name: name.trim(), allowedDomains })}
          >
            {saving ? "저장 중" : "저장"}
          </Button>
          {savedMessage ? <span className="settings-success">{savedMessage}</span> : null}
        </div>
      </Card>
    </main>
  );
}

function roleLabel(role: ProjectSettingsViewModel["role"]): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Viewer";
}
```

- [ ] **Step 4: Add settings page styles**

In `apps/admin/src/pages/pages.css`, add:

```css
.settings-subtitle {
  margin-top: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.settings-notice {
  margin-bottom: var(--space-5);
  border-left: 3px solid var(--status-warn);
  background: var(--surface-sunk);
  padding: 12px 14px;
  color: var(--ink);
  font-weight: 700;
}

.settings-panel {
  display: grid;
  gap: var(--space-5);
  max-width: 720px;
  padding: 18px;
}

.settings-actions {
  display: flex;
  align-items: center;
  gap: var(--space-5);
}

.settings-success {
  color: var(--status-good);
  font-weight: 700;
}
```

- [ ] **Step 5: Run page tests and verify they pass**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/ProjectSettingsPage.tsx apps/admin/src/pages/ProjectSettingsPage.test.tsx apps/admin/src/pages/pages.css
git commit -m "관리자: 프로젝트 설정 화면 추가"
```

---

### Task 5: Admin API Client

**Files:**
- Modify: `apps/admin/src/api.ts`

**Interfaces:**
- Consumes:
  - `GET /admin/api/projects/:projectId`
  - `PATCH /admin/api/projects/:projectId`
- Produces:
  - `ProjectRole = "owner" | "admin" | "viewer"`
  - `ProjectSettingsResponse`
  - `getProjectSettings(projectId)`
  - `updateProjectSettings(projectId, input, csrfToken)`

- [ ] **Step 1: Add shared client types**

In `apps/admin/src/api.ts`, add these exports after imports.

```ts
export type ProjectRole = "owner" | "admin" | "viewer";

export interface ProjectSettingsResponse {
  projectId: string;
  name: string;
  allowedDomains: string[];
  role: ProjectRole;
}
```

Update `AuthMeResponse.projects` to use `ProjectRole`.

```ts
  projects: Array<{ projectId: string; role: ProjectRole }>;
```

- [ ] **Step 2: Add client functions**

In `apps/admin/src/api.ts`, add these functions after `createProject(...)`.

```ts
export async function getProjectSettings(projectId: string): Promise<ProjectSettingsResponse> {
  return getJson<ProjectSettingsResponse>(`/admin/api/projects/${projectId}`);
}

export async function updateProjectSettings(
  projectId: string,
  input: { name: string; allowedDomains: string[] },
  csrfToken: string,
): Promise<ProjectSettingsResponse> {
  const response = await ensureSuccess(`/admin/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-trace-csrf": csrfToken },
    body: JSON.stringify(input),
  });

  return response.json() as Promise<ProjectSettingsResponse>;
}
```

- [ ] **Step 3: Run admin typecheck**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck --workspace @trace/admin
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/api.ts
git commit -m "관리자: 프로젝트 설정 API 클라이언트 추가"
```

---

### Task 6: App Integration

**Files:**
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.test.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/App.test.tsx`
- Modify: `apps/admin/src/App.loading.test.tsx`

**Interfaces:**
- Consumes:
  - `getProjectSettings(projectId)`
  - `updateProjectSettings(projectId, input, csrfToken)`
  - `ProjectSettingsPage`
- Produces:
  - `AppState` variant `{ type: "settings"; project; dashboardData; projectId; userEmail; csrfToken; saving?; error?; savedMessage? }`
  - `DashboardPage` prop `onShowSettings: () => void`

- [ ] **Step 1: Add failing App integration tests**

In `apps/admin/src/App.test.tsx`, add `getProjectSettings` and `updateProjectSettings` to the hoisted mock object.

```ts
  getProjectSettings: vi.fn(),
  updateProjectSettings: vi.fn(),
```

Add both exports to `vi.mock("./api", ...)`.

```ts
  getProjectSettings: api.getProjectSettings,
  updateProjectSettings: api.updateProjectSettings,
```

Add default mock behavior in `beforeEach`.

```ts
  api.getProjectSettings.mockResolvedValue({
    projectId: "proj_demo",
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
    role: "owner",
  });
  api.updateProjectSettings.mockResolvedValue({
    projectId: "proj_demo",
    name: "New Demo",
    allowedDomains: ["https://new.example.com"],
    role: "owner",
  });
```

Add these tests under a new `describe("App 프로젝트 설정", ...)`.

```tsx
describe("App 프로젝트 설정", () => {
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

  it("프로젝트 설정 저장 실패를 화면에 표시한다", async () => {
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

    expect(await screen.findByText("invalid_project_settings")).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toHaveValue("New Demo");
  });
});
```

- [ ] **Step 2: Run App tests and verify they fail**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: FAIL because the dashboard has no settings button and `App` does not import settings API/page.

- [ ] **Step 3: Add DashboardPage settings entry point**

In `apps/admin/src/pages/DashboardPage.tsx`, add prop `onShowSettings`.

```ts
  onShowSettings,
```

Add it to the prop type.

```ts
  onShowSettings: () => void;
```

Add a button in `.header-actions` before `설치 안내`.

```tsx
          <Button onClick={onShowSettings}>프로젝트 설정</Button>
```

- [ ] **Step 4: Update DashboardPage test**

In `apps/admin/src/pages/DashboardPage.test.tsx`, add the required prop to the existing render call.

```tsx
        onShowSettings={vi.fn()}
```

Add a test that verifies the button is present.

```tsx
  it("프로젝트 설정 버튼을 보여준다", () => {
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
        onShowSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "프로젝트 설정" })).toBeInTheDocument();
  });
```

- [ ] **Step 5: Import settings APIs and page in App**

In `apps/admin/src/App.tsx`, update imports.

```ts
import {
  ApiError,
  createProject,
  getAuthMe,
  getDashboardData,
  getProjectSettings,
  logout,
  updateProjectSettings,
  type ProjectSettingsResponse,
} from "./api.js";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage.js";
```

- [ ] **Step 6: Add settings state**

In `AppState`, add:

```ts
  | {
      type: "settings";
      project: ProjectSettingsResponse;
      dashboardData: { summary: DashboardSummary; issues: Issue[] };
      projectId: string;
      userEmail: string;
      csrfToken: string;
      saving?: boolean;
      error?: string | undefined;
      savedMessage?: string | undefined;
    }
```

- [ ] **Step 7: Add settings handlers**

Before `handleLogout`, add:

```ts
  const handleShowSettings = async () => {
    if (state.type !== "ready") return;
    try {
      const project = await getProjectSettings(state.projectId);
      setState({
        type: "settings",
        project,
        dashboardData: state.data,
        projectId: state.projectId,
        userEmail: state.userEmail,
        csrfToken: state.csrfToken,
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

Add a settings render branch before `handleLogout`.

```tsx
  if (state.type === "settings") {
    const handleSaveSettings = async (input: { name: string; allowedDomains: string[] }) => {
      setState((current) =>
        current.type === "settings"
          ? { ...current, saving: true, error: undefined, savedMessage: undefined }
          : current,
      );
      try {
        const project = await updateProjectSettings(state.projectId, input, state.csrfToken);
        setState((current) =>
          current.type === "settings"
            ? { ...current, project, saving: false, savedMessage: "저장했습니다." }
            : current,
        );
      } catch (error) {
        setState((current) =>
          current.type === "settings"
            ? {
                ...current,
                saving: false,
                error: error instanceof ApiError ? error.message : "프로젝트 설정을 저장하지 못했습니다.",
              }
            : current,
        );
      }
    };

    return (
      <ProjectSettingsPage
        project={state.project}
        saving={state.saving}
        error={state.error}
        savedMessage={state.savedMessage}
        onSave={(input) => { void handleSaveSettings(input); }}
        onBack={() =>
          setState({
            type: "ready",
            data: state.dashboardData,
            projectId: state.projectId,
            userEmail: state.userEmail,
            csrfToken: state.csrfToken,
          })
        }
      />
    );
  }
```

In the `DashboardPage` render, pass:

```tsx
        onShowSettings={() => { void handleShowSettings(); }}
```

- [ ] **Step 8: Update App.loading.test API mock**

In `apps/admin/src/App.loading.test.tsx`, add the new mocked API exports.

```ts
  getProjectSettings: vi.fn(),
  updateProjectSettings: vi.fn(),
```

- [ ] **Step 9: Run App and dashboard tests and verify they pass**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.loading.test.tsx src/pages/DashboardPage.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/DashboardPage.test.tsx apps/admin/src/App.tsx apps/admin/src/App.test.tsx apps/admin/src/App.loading.test.tsx
git commit -m "관리자: 프로젝트 설정 화면 연결"
```

---

### Task 7: Full Verification

**Files:**
- No source files are modified in this task.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified implementation ready for review.

- [ ] **Step 1: Run full tests**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build
```

Expected: PASS.

- [ ] **Step 4: Check worktree**

Run:

```bash
git status --short
```

Expected: no output.

---

## Self-Review Notes

- Spec coverage: 조회/수정 API, store 계약, owner/admin/viewer 권한, viewer 읽기 전용 UI, audit log, validation, 테스트가 각 태스크에 매핑되어 있다.
- Scope check: 프로젝트 삭제, 멤버 관리, 프로젝트 전환 UI는 제외 상태로 유지된다.
- Type consistency: `ProjectSettingsResponse`와 `ProjectSettingsViewModel`의 필드는 `projectId`, `name`, `allowedDomains`, `role`로 일치한다.
- No placeholders: 모든 태스크는 파일, 인터페이스, 테스트 코드, 구현 코드, 검증 명령, 커밋 명령을 포함한다.
