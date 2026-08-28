# Project Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 설정 화면에서 기존 관리자 사용자를 `admin` 또는 `viewer` 역할로 프로젝트에 추가하고, 현재 프로젝트 멤버 목록을 볼 수 있게 만든다.

**Architecture:** 서버는 기존 Admin BFF인 `apps/api/src/routes/admin-proxy.ts`에 멤버 조회와 추가 엔드포인트를 둔다. 데이터 접근은 `TraceStore` 계약에 이메일 조회와 프로젝트별 멤버십 목록 조회를 추가하고, Admin UI는 설정 화면 진입 시 설정과 멤버 목록을 함께 불러온 뒤 owner에게만 추가 폼을 보여준다.

**Tech Stack:** TypeScript, Fastify, Zod, better-sqlite3, React, Vite, Vitest, Testing Library

## Global Constraints

- 프로젝트 기본 커뮤니케이션과 사용자-facing 문구는 한국어를 사용한다.
- 멤버 추가 대상은 이미 `admin_users`에 존재하는 사용자만 허용한다.
- 프로젝트 멤버 역할은 `owner`, `admin`, `viewer`이며 추가 폼에서는 `admin` 또는 `viewer`만 선택할 수 있다.
- 프로젝트 멤버 목록은 `owner`, `admin`, `viewer`가 모두 조회할 수 있다.
- 멤버 추가는 `owner`만 가능하며 `admin`과 `viewer`에게는 읽기 전용 안내를 표시한다.
- 초대 이메일, 초대 토큰, 대기 초대, 멤버 제거, 역할 변경, owner 이전, 마지막 owner 보호는 이번 범위에 포함하지 않는다.
- 설정 화면 진입 중 프로젝트 전환이나 로그아웃으로 상태가 바뀌면 지연 응답이 현재 화면을 덮어쓰지 않아야 한다.
- 검증 명령은 `npm run typecheck`, `npm test`, `git diff --check`이다.

---

## File Structure

- `apps/api/src/store/types.ts`: `TraceStore` 계약에 `getAdminUserByEmail`과 `listProjectMemberships`를 추가한다.
- `apps/api/src/store/memory-store.ts`: 메모리 스토어에서 이메일 조회와 프로젝트별 멤버십 목록을 구현한다.
- `apps/api/src/store/sqlite-store.ts`: SQLite 스토어에서 이메일 조회와 프로젝트별 멤버십 목록을 구현한다.
- `apps/api/src/store/store-contract.test.ts`: 두 스토어 구현이 같은 멤버 조회 계약을 만족하는지 검증한다.
- `apps/api/src/routes/admin.ts`: 멤버 추가 요청 검증용 Zod 스키마를 추가한다.
- `apps/api/src/routes/admin-proxy.ts`: `GET /admin/api/projects/:projectId/members`와 `POST /admin/api/projects/:projectId/members`를 구현한다.
- `apps/api/src/routes/admin.test.ts`: 멤버 조회와 추가 API의 권한, 오류, 감사 로그를 검증한다.
- `apps/admin/src/api.ts`: 멤버 응답 타입과 조회/추가 API 클라이언트를 추가한다.
- `apps/admin/src/pages/ProjectSettingsPage.tsx`: 멤버 목록과 owner 전용 추가 폼을 설정 화면 하단에 추가한다.
- `apps/admin/src/pages/ProjectSettingsPage.test.tsx`: 설정 화면의 멤버 목록, 추가 폼, 읽기 전용 안내를 검증한다.
- `apps/admin/src/App.tsx`: 설정 진입 시 멤버 목록을 함께 로드하고 추가 성공/실패 상태를 관리한다.
- `apps/admin/src/App.test.tsx`: API 호출 결합, 추가 성공, 오류 매핑, stale response guard를 검증한다.
- `apps/admin/src/pages/pages.css`: 설정 화면 멤버 섹션 스타일을 추가한다.

---

### Task 1: Store Member Lookup Contract

**Files:**
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: existing `AdminUserRecord`, `ProjectMembershipRecord`, `TraceStore`, `upsertAdminUserFromGoogle`, `addProjectMembership`.
- Produces:
  - `TraceStore.getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined>`
  - `TraceStore.listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]>`

- [ ] **Step 1: Write failing store contract tests**

Add the following tests inside `describeTraceStoreContract` in `apps/api/src/store/store-contract.test.ts`, near the existing admin user and membership tests:

```ts
    it("정규화한 이메일로 관리자 사용자를 조회한다", async () => {
      const store = open();
      const user = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_email_lookup",
        email: "Member@Example.com",
        emailVerified: true,
        name: "Member",
        now: "2026-08-25T00:00:00.000Z",
      });

      await expect(store.getAdminUserByEmail("member@example.com")).resolves.toMatchObject({
        adminUserId: user.adminUserId,
        email: "member@example.com",
        name: "Member",
      });
      await expect(store.getAdminUserByEmail("MEMBER@example.com")).resolves.toMatchObject({
        adminUserId: user.adminUserId,
        email: "member@example.com",
      });
      await expect(store.getAdminUserByEmail("missing@example.com")).resolves.toBeUndefined();
    });

    it("프로젝트별 멤버십 목록만 조회한다", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_owner",
        email: "owner@example.com",
        emailVerified: true,
        now: "2026-08-25T00:00:00.000Z",
      });
      const viewer = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_viewer",
        email: "viewer@example.com",
        emailVerified: true,
        now: "2026-08-25T00:01:00.000Z",
      });
      const other = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_other",
        email: "other@example.com",
        emailVerified: true,
        now: "2026-08-25T00:02:00.000Z",
      });
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const otherProject = await store.createProject({
        name: "Other",
        allowedDomains: ["https://other.example.com"],
      });

      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: viewer.adminUserId,
        role: "viewer",
        createdAt: "2026-08-25T00:01:00.000Z",
      });
      await store.addProjectMembership({
        projectId: otherProject.projectId,
        adminUserId: other.adminUserId,
        role: "admin",
        createdAt: "2026-08-25T00:02:00.000Z",
      });

      await expect(store.listProjectMemberships(project.projectId)).resolves.toEqual([
        {
          projectId: project.projectId,
          adminUserId: owner.adminUserId,
          role: "owner",
          createdAt: "2026-08-25T00:00:00.000Z",
        },
        {
          projectId: project.projectId,
          adminUserId: viewer.adminUserId,
          role: "viewer",
          createdAt: "2026-08-25T00:01:00.000Z",
        },
      ]);
    });
```

- [ ] **Step 2: Run the failing store tests**

Run: `npm run test --workspace @trace/api -- src/store/store-contract.test.ts`

Expected: FAIL because `TraceStore` does not define `getAdminUserByEmail` or `listProjectMemberships`.

- [ ] **Step 3: Add the store interface methods**

In `apps/api/src/store/types.ts`, add these methods to `TraceStore` directly after `getAdminUser`:

```ts
  getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined>;
```

Add this method directly after `listProjectMembershipsForUser`:

```ts
  listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]>;
```

- [ ] **Step 4: Implement MemoryStore methods**

In `apps/api/src/store/memory-store.ts`, add this method after `getAdminUser`:

```ts
  async getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined> {
    const googleSub = this.adminUsersByEmail.get(email.toLowerCase());
    return googleSub ? this.adminUsers.get(googleSub) : undefined;
  }
```

Add this method after `listProjectMembershipsForUser`:

```ts
  async listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]> {
    return Array.from(this.projectMemberships.values()).filter((membership) => membership.projectId === projectId);
  }
```

- [ ] **Step 5: Implement SqliteStore methods**

In `apps/api/src/store/sqlite-store.ts`, add this method after `getAdminUser`:

```ts
  async getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM admin_users WHERE email = ?`).get(email.toLowerCase()) as
      | Row
      | undefined;
    if (!row) return undefined;

    return compact({
      adminUserId: row.admin_user_id as string,
      googleSub: row.google_sub as string,
      email: row.email as string,
      emailVerified: row.email_verified === 1,
      name: row.name as string | null,
      pictureUrl: row.picture_url as string | null,
      createdAt: row.created_at as string,
      lastLoginAt: row.last_login_at as string,
    }) as AdminUserRecord;
  }
```

Add this method after `listProjectMembershipsForUser`:

```ts
  async listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM project_memberships WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as Row[];

    return rows.map((row) => this.toMembership(row));
  }
```

- [ ] **Step 6: Run store verification**

Run: `npm run test --workspace @trace/api -- src/store/store-contract.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/store/types.ts apps/api/src/store/memory-store.ts apps/api/src/store/sqlite-store.ts apps/api/src/store/store-contract.test.ts
git commit -m "관리자: 프로젝트 멤버 스토어 조회 추가"
```

---

### Task 2: API Member Listing

**Files:**
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes:
  - `TraceStore.listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]>`
  - `TraceStore.getAdminUser(adminUserId: string): Promise<AdminUserRecord | undefined>`
- Produces:
  - `GET /admin/api/projects/:projectId/members`
  - response type `Array<{ adminUserId: string; email: string; name?: string; role: AdminRole; createdAt: string }>`

- [ ] **Step 1: Write failing API listing tests**

Add these tests to `apps/api/src/routes/admin.test.ts` after the project settings GET tests:

```ts
  it("returns project members for a project member", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer",
      email: "viewer@example.com",
      emailVerified: true,
      name: "Viewer",
      now: "2026-08-25T00:01:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "admin",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: viewer.adminUserId,
      role: "viewer",
      createdAt: "2026-08-27T00:01:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        adminUserId: user.adminUserId,
        email: "admin@example.com",
        role: "admin",
        createdAt: "2026-08-27T00:00:00.000Z",
      },
      {
        adminUserId: viewer.adminUserId,
        email: "viewer@example.com",
        name: "Viewer",
        role: "viewer",
        createdAt: "2026-08-27T00:01:00.000Z",
      },
    ]);
  });

  it("returns 403 and audits when members are requested by a non-member", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Private",
      allowedDomains: ["https://private.example.com"],
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_access_denied" });
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "project_members" },
      }),
    ]));
  });
```

- [ ] **Step 2: Run the failing API listing tests**

Run: `npm run test --workspace @trace/api -- src/routes/admin.test.ts -t "members"`

Expected: FAIL with HTTP 404 for the members endpoint.

- [ ] **Step 3: Add the members resource type**

In `apps/api/src/routes/admin-proxy.ts`, extend `ProjectResourceType`:

```ts
  | "project_members";
```

- [ ] **Step 4: Add the listing route**

In `registerAdminProxyRoutes`, place this route after `GET /admin/api/projects/:projectId` and before `PATCH /admin/api/projects/:projectId`:

```ts
  app.get("/admin/api/projects/:projectId/members", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_members");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const memberships = await options.store.listProjectMemberships(projectId);
    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await options.store.getAdminUser(membership.adminUserId);
        return toProjectMemberResponse(membership, user);
      }),
    );

    return members.filter((member): member is ProjectMemberResponse => member !== undefined);
  });
```

- [ ] **Step 5: Add response helper types and mapper**

In `apps/api/src/routes/admin-proxy.ts`, add `AdminUserRecord` to the store type import:

```ts
import type { AdminRole, AdminUserRecord, ProjectMembershipRecord, ProjectRecord, TraceStore } from "../store/types.js";
```

Add these helpers near `toProjectSettingsResponse`:

```ts
type ProjectMemberResponse = {
  adminUserId: string;
  email: string;
  name?: string;
  role: AdminRole;
  createdAt: string;
};

function toProjectMemberResponse(
  membership: ProjectMembershipRecord,
  user: AdminUserRecord | undefined,
): ProjectMemberResponse | undefined {
  if (!user) return undefined;
  const response: ProjectMemberResponse = {
    adminUserId: membership.adminUserId,
    email: user.email,
    role: membership.role,
    createdAt: membership.createdAt,
  };
  if (user.name !== undefined) response.name = user.name;
  return response;
}
```

- [ ] **Step 6: Run API listing verification**

Run: `npm run test --workspace @trace/api -- src/routes/admin.test.ts -t "members"`

Expected: PASS for the two listing tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.test.ts
git commit -m "관리자: 프로젝트 멤버 목록 API 추가"
```

---

### Task 3: API Add Project Member

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes:
  - `TraceStore.getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined>`
  - `TraceStore.getProjectMembership(projectId: string, adminUserId: string): Promise<ProjectMembershipRecord | undefined>`
  - `TraceStore.addProjectMembership(input: AddProjectMembershipInput): Promise<ProjectMembershipRecord>`
- Produces:
  - `addProjectMemberSchema` with `{ email: string; role: "admin" | "viewer" }`
  - `POST /admin/api/projects/:projectId/members`
  - audit action `project.member_added`

- [ ] **Step 1: Write failing API add tests**

Add these tests to `apps/api/src/routes/admin.test.ts` after the listing tests:

```ts
  it("lets an owner add an existing admin user as a project member", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const added = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_added",
      email: "added@example.com",
      emailVerified: true,
      name: "Added User",
      now: "2026-08-25T00:01:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "POST",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { email: "ADDED@example.com", role: "viewer" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      adminUserId: added.adminUserId,
      email: "added@example.com",
      name: "Added User",
      role: "viewer",
    });
    expect(await store.getProjectMembership(project.projectId, added.adminUserId)).toMatchObject({
      role: "viewer",
    });
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.member_added",
        projectId: project.projectId,
        metadata: {
          addedAdminUserId: added.adminUserId,
          email: "added@example.com",
          role: "viewer",
        },
      }),
    ]));
  });

  it("lets an owner add an existing admin user as admin", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const added = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_added_admin",
      email: "added-admin@example.com",
      emailVerified: true,
      now: "2026-08-25T00:01:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "POST",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { email: "added-admin@example.com", role: "admin" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      adminUserId: added.adminUserId,
      email: "added-admin@example.com",
      role: "admin",
    });
  });

  it("rejects project member creation from admin and viewer members", async () => {
    for (const role of ["admin", "viewer"] as const) {
      const { store, user, cookie, csrfToken } = await signedInStore();
      const project = await store.createProject({
        name: `Demo ${role}`,
        allowedDomains: [`https://${role}.example.com`],
      });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: user.adminUserId,
        role,
        createdAt: "2026-08-27T00:00:00.000Z",
      });
      const app = createApp({ store, authConfig });

      const response = await app.inject({
        method: "POST",
        url: `/admin/api/projects/${project.projectId}/members`,
        headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
        payload: { email: "new@example.com", role: "viewer" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "project_role_forbidden" });
    }
  });

  it("rejects missing users, duplicate members, and invalid member roles", async () => {
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

    const missing = await app.inject({
      method: "POST",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { email: "missing@example.com", role: "viewer" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "admin_user_not_found" });

    const duplicate = await app.inject({
      method: "POST",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { email: "admin@example.com", role: "viewer" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: "project_member_exists" });

    const invalidRole = await app.inject({
      method: "POST",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { email: "admin@example.com", role: "owner" },
    });
    expect(invalidRole.statusCode).toBe(400);
    expect(invalidRole.json()).toEqual({ error: "invalid_project_member" });
  });
```

- [ ] **Step 2: Run the failing API add tests**

Run: `npm run test --workspace @trace/api -- src/routes/admin.test.ts -t "add an existing admin user|rejects"`

Expected: FAIL because the POST members endpoint and schema do not exist.

- [ ] **Step 3: Add the Zod schema**

In `apps/api/src/routes/admin.ts`, export the schema:

```ts
export const addProjectMemberSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  role: z.enum(["admin", "viewer"]),
});
```

- [ ] **Step 4: Import the schema and add the route**

In `apps/api/src/routes/admin-proxy.ts`, update the admin import:

```ts
import { addProjectMemberSchema, createProjectSchema, updateProjectSchema } from "./admin.js";
```

Add this route after the members GET route:

```ts
  app.post("/admin/api/projects/:projectId/members", async (request, reply) => {
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
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_members");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
    if (access.membership.role !== "owner") {
      return reply.code(403).send({ error: "project_role_forbidden" });
    }

    const parsed = addProjectMemberSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_project_member" });

    const user = await options.store.getAdminUserByEmail(parsed.data.email);
    if (!user) return reply.code(404).send({ error: "admin_user_not_found" });

    const existing = await options.store.getProjectMembership(projectId, user.adminUserId);
    if (existing) return reply.code(409).send({ error: "project_member_exists" });

    const createdAt = new Date().toISOString();
    const membership = await options.store.addProjectMembership({
      projectId,
      adminUserId: user.adminUserId,
      role: parsed.data.role,
      createdAt,
    });

    await options.store.createAuditLog({
      adminUserId: authenticated.adminUserId,
      action: "project.member_added",
      projectId,
      createdAt,
      metadata: {
        addedAdminUserId: user.adminUserId,
        email: user.email,
        role: parsed.data.role,
      },
    });

    return reply.code(201).send(toProjectMemberResponse(membership, user));
  });
```

- [ ] **Step 5: Run API add verification**

Run: `npm run test --workspace @trace/api -- src/routes/admin.test.ts -t "members|add an existing admin user|rejects"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.test.ts
git commit -m "관리자: 프로젝트 멤버 추가 API 추가"
```

---

### Task 4: Admin API Client and Settings Page Member UI

**Files:**
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/pages/ProjectSettingsPage.tsx`
- Modify: `apps/admin/src/pages/pages.css`
- Test: `apps/admin/src/pages/ProjectSettingsPage.test.tsx`

**Interfaces:**
- Consumes:
  - `ProjectRole = "owner" | "admin" | "viewer"`
- Produces:
  - `ProjectMemberResponse`
  - `AddProjectMemberInput`
  - `getProjectMembers(projectId: string): Promise<ProjectMemberResponse[]>`
  - `addProjectMember(projectId: string, input: AddProjectMemberInput, csrfToken: string): Promise<ProjectMemberResponse>`
  - `ProjectSettingsPage` props `members`, `addingMember`, `memberError`, `memberSavedMessage`, `onAddMember`

- [ ] **Step 1: Write failing page tests**

Update `apps/admin/src/pages/ProjectSettingsPage.test.tsx` test render calls by adding `members={members}` and `onAddMember={() => undefined}`. Define this fixture near `ownerProject`:

```ts
const members = [
  {
    adminUserId: "admin_owner",
    email: "owner@example.com",
    name: "Owner",
    role: "owner" as const,
    createdAt: "2026-08-25T00:00:00.000Z",
  },
  {
    adminUserId: "admin_viewer",
    email: "viewer@example.com",
    role: "viewer" as const,
    createdAt: "2026-08-26T00:00:00.000Z",
  },
];
```

Add these tests:

```ts
  it("renders project members and owner add form", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        members={members}
        onBack={() => undefined}
        onSave={() => undefined}
        onAddMember={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "멤버" })).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("viewer@example.com")).toBeInTheDocument();
    expect(screen.getByText("조회자")).toBeInTheDocument();
    expect(screen.getByLabelText("멤버 이메일")).toBeInTheDocument();
    expect(screen.getByLabelText("멤버 역할")).toHaveValue("viewer");
    expect(screen.getByRole("button", { name: "멤버 추가" })).toBeDisabled();
  });

  it("submits a member email and selected role", () => {
    const onAddMember = vi.fn();
    render(
      <ProjectSettingsPage
        project={ownerProject}
        members={members}
        onBack={() => undefined}
        onSave={() => undefined}
        onAddMember={onAddMember}
      />,
    );

    fireEvent.change(screen.getByLabelText("멤버 이메일"), { target: { value: " New@Example.com " } });
    fireEvent.change(screen.getByLabelText("멤버 역할"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(onAddMember).toHaveBeenCalledWith({ email: "New@Example.com", role: "admin" });
  });

  it("renders non-owner member management as read-only", () => {
    render(
      <ProjectSettingsPage
        project={Object.assign({}, ownerProject, { role: "admin" as const })}
        members={members}
        onBack={() => undefined}
        onSave={() => undefined}
        onAddMember={() => undefined}
      />,
    );

    expect(screen.getByText("멤버 추가 권한이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByLabelText("멤버 이메일")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "멤버 추가" })).not.toBeInTheDocument();
  });

  it("shows member add state messages", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        members={members}
        memberError="이미 이 프로젝트의 멤버입니다."
        memberSavedMessage="멤버를 추가했습니다."
        onBack={() => undefined}
        onSave={() => undefined}
        onAddMember={() => undefined}
      />,
    );

    expect(screen.getByText("이미 이 프로젝트의 멤버입니다.")).toBeInTheDocument();
    expect(screen.getByText("멤버를 추가했습니다.")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the failing page tests**

Run: `npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx`

Expected: FAIL because `ProjectSettingsPage` does not accept member props or render the member section.

- [ ] **Step 3: Add Admin API client types and functions**

In `apps/admin/src/api.ts`, add the types after `ProjectSettingsResponse`:

```ts
export interface ProjectMemberResponse {
  adminUserId: string;
  email: string;
  name?: string;
  role: ProjectRole;
  createdAt: string;
}

export interface AddProjectMemberInput {
  email: string;
  role: Extract<ProjectRole, "admin" | "viewer">;
}
```

Add these functions after `getProjectSettings`:

```ts
export async function getProjectMembers(projectId: string): Promise<ProjectMemberResponse[]> {
  return getJson<ProjectMemberResponse[]>(`/admin/api/projects/${projectId}/members`);
}

export async function addProjectMember(
  projectId: string,
  input: AddProjectMemberInput,
  csrfToken: string,
): Promise<ProjectMemberResponse> {
  const response = await ensureSuccess(`/admin/api/projects/${projectId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-trace-csrf": csrfToken },
    body: JSON.stringify(input),
  });

  return response.json() as Promise<ProjectMemberResponse>;
}
```

- [ ] **Step 4: Extend ProjectSettingsPage props and local state**

In `apps/admin/src/pages/ProjectSettingsPage.tsx`, import the member types:

```ts
import type { AddProjectMemberInput, ProjectMemberResponse } from "../api.js";
```

Extend props:

```ts
interface ProjectSettingsPageProps {
  project: ProjectSettingsViewModel;
  members: ProjectMemberResponse[];
  onBack: () => void;
  onSave: (input: { name: string; allowedDomains: string[] }) => void;
  onAddMember: (input: AddProjectMemberInput) => void;
  saving?: boolean;
  addingMember?: boolean;
  error?: string | undefined;
  savedMessage?: string | undefined;
  memberError?: string | undefined;
  memberSavedMessage?: string | undefined;
}
```

Inside the component, add state:

```ts
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<AddProjectMemberInput["role"]>("viewer");
```

Add submit handler:

```ts
  const handleAddMemberSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = memberEmail.trim();
    if (!trimmedEmail) return;
    onAddMember({ email: trimmedEmail, role: memberRole });
  };
```

Ensure the existing React import includes `FormEvent` if the file already imports React types.

- [ ] **Step 5: Render the member section**

In `ProjectSettingsPage`, add this panel below the existing settings panel:

```tsx
      <Card className="settings-panel members-panel">
        <div className="panel-heading">
          <h2>멤버</h2>
        </div>
        <div className="members-list">
          {members.map((member) => (
            <div className="member-row" key={member.adminUserId}>
              <div>
                <strong>{member.name !== undefined ? member.name : member.email}</strong>
                {member.name ? <span>{member.email}</span> : null}
              </div>
              <div className="member-meta">
                <span>{roleLabel(member.role)}</span>
                <span>{member.createdAt.slice(0, 10)}</span>
              </div>
            </div>
          ))}
        </div>
        {project.role === "owner" ? (
          <form className="member-add-form" onSubmit={handleAddMemberSubmit}>
            <Field label="멤버 이메일">
              <input
                value={memberEmail}
                onChange={(event) => setMemberEmail(event.target.value)}
                disabled={addingMember}
              />
            </Field>
            <Field label="멤버 역할">
              <select
                value={memberRole}
                onChange={(event) => setMemberRole(event.target.value as AddProjectMemberInput["role"])}
                disabled={addingMember}
              >
                <option value="viewer">조회자</option>
                <option value="admin">관리자</option>
              </select>
            </Field>
            <div className="settings-actions">
              <button className="primary-button" type="submit" disabled={addingMember || memberEmail.trim() === ""}>
                {addingMember ? "추가 중" : "멤버 추가"}
              </button>
              {memberSavedMessage ? <span className="settings-success">{memberSavedMessage}</span> : null}
            </div>
            {memberError ? <p className="form-error">{memberError}</p> : null}
          </form>
        ) : (
          <p className="settings-subtitle">멤버 추가 권한이 없습니다.</p>
        )}
      </Card>
```

- [ ] **Step 6: Add member section styles**

In `apps/admin/src/pages/pages.css`, add these classes near the existing settings styles:

```css
.members-panel {
  margin-top: var(--space-5);
}

.members-list {
  display: grid;
  gap: var(--space-3);
}

.member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
}

.member-row strong,
.member-row span {
  display: block;
}

.member-row span,
.member-meta {
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.member-meta {
  display: grid;
  gap: var(--space-1);
  min-width: 96px;
  text-align: right;
}

.member-add-form {
  display: grid;
  gap: var(--space-4);
  border-top: 1px solid var(--border);
  padding-top: var(--space-5);
}
```

- [ ] **Step 7: Run page verification**

Run: `npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/api.ts apps/admin/src/pages/ProjectSettingsPage.tsx apps/admin/src/pages/pages.css apps/admin/src/pages/ProjectSettingsPage.test.tsx
git commit -m "관리자: 설정 화면 멤버 UI 추가"
```

---

### Task 5: Admin App Integration and Stale Response Guard

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Test: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `getProjectSettings(projectId: string): Promise<ProjectSettingsResponse>`
  - `getProjectMembers(projectId: string): Promise<ProjectMemberResponse[]>`
  - `addProjectMember(projectId: string, input: AddProjectMemberInput, csrfToken: string): Promise<ProjectMemberResponse>`
  - `ProjectSettingsPage` props from Task 4
- Produces:
  - App settings state containing `members: ProjectMemberResponse[]`
  - member add error mapping for `admin_user_not_found`, `project_member_exists`, `project_role_forbidden`, `invalid_project_member`, `csrf_origin_invalid`, `csrf_token_invalid`

- [ ] **Step 1: Write failing App tests**

Update the hoisted API mock in `apps/admin/src/App.test.tsx`:

```ts
  getProjectMembers: vi.fn(),
  addProjectMember: vi.fn(),
```

Update `vi.mock("./api")` to export the two functions:

```ts
  getProjectMembers: api.getProjectMembers,
  addProjectMember: api.addProjectMember,
```

Add default mocks in `beforeEach`:

```ts
  api.getProjectMembers.mockResolvedValue([
    {
      adminUserId: "admin_1",
      email: "admin@example.com",
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    },
  ]);
  api.addProjectMember.mockResolvedValue({
    adminUserId: "admin_added",
    email: "added@example.com",
    role: "viewer",
    createdAt: "2026-08-28T00:00:00.000Z",
  });
```

Add these tests in the settings-related `describe` block. If there is no settings-specific block, add `describe("App project settings members", () => { })` after the project switcher tests and place the tests inside it:

```ts
  it("loads project settings and members together before opening settings", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "설정" }));

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

    fireEvent.click(await screen.findByRole("button", { name: "설정" }));
    fireEvent.change(await screen.findByLabelText("멤버 이메일"), {
      target: { value: "added@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(await screen.findByText("멤버를 추가했습니다.")).toBeInTheDocument();
    expect(api.addProjectMember).toHaveBeenCalledWith(
      "proj_demo",
      { email: "added@example.com", role: "viewer" },
      "csrf_1",
    );
    expect(screen.getByText("added@example.com")).toBeInTheDocument();
  });

  it("maps project member add errors to Korean messages", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    api.addProjectMember.mockRejectedValue(new api.ApiError(409, "project_member_exists"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "설정" }));
    fireEvent.change(await screen.findByLabelText("멤버 이메일"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(await screen.findByText("이미 이 프로젝트의 멤버입니다.")).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: "설정" }));
    fireEvent.change(await screen.findByLabelText("프로젝트 선택"), { target: { value: "proj_b" } });
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
```

- [ ] **Step 2: Run the failing App tests**

Run: `npm run test --workspace @trace/admin -- src/App.test.tsx`

Expected: FAIL because App does not call member APIs or pass member props.

- [ ] **Step 3: Import member APIs and types**

In `apps/admin/src/App.tsx`, extend the API import:

```ts
  addProjectMember,
  getProjectMembers,
  type AddProjectMemberInput,
  type ProjectMemberResponse,
```

- [ ] **Step 4: Add member error mapping**

Add this map near `PROJECT_SETTINGS_ERROR_MESSAGES`:

```ts
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
```

- [ ] **Step 5: Extend settings AppState**

In the `settings` variant of `AppState`, add:

```ts
      members: ProjectMemberResponse[];
      addingMember?: boolean;
      memberError?: string | undefined;
      memberSavedMessage?: string | undefined;
```

- [ ] **Step 6: Load settings and members together**

Replace the single settings fetch in `handleShowSettings`:

```ts
      const project = await getProjectSettings(projectId);
```

with:

```ts
      const [project, members] = await Promise.all([
        getProjectSettings(projectId),
        getProjectMembers(projectId),
      ]);
```

In the success transition, include `members`:

```ts
              members,
```

Keep the current guard:

```ts
current.type === "ready" && current.projectId === projectId
```

This guard must remain after both promises resolve so stale settings or members results cannot open the wrong settings screen.

- [ ] **Step 7: Add member submit handler**

Inside `if (state.type === "settings")`, add this handler near `handleSaveSettings`:

```ts
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
```

- [ ] **Step 8: Pass member props to ProjectSettingsPage**

Update the `ProjectSettingsPage` render:

```tsx
      <ProjectSettingsPage
        project={state.project}
        members={state.members}
        saving={state.saving === true}
        addingMember={state.addingMember === true}
        error={state.error}
        savedMessage={state.savedMessage}
        memberError={state.memberError}
        memberSavedMessage={state.memberSavedMessage}
        onSave={(input) => { void handleSaveSettings(input); }}
        onAddMember={(input) => { void handleAddMember(input); }}
        onBack={() =>
          setState({
            type: "ready",
            data: state.dashboardData,
            projects: state.projects,
            projectId: state.projectId,
            userEmail: state.userEmail,
            csrfToken: state.csrfToken,
          })
        }
      />
```

- [ ] **Step 9: Run App verification**

Run: `npm run test --workspace @trace/admin -- src/App.test.tsx`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "관리자: 프로젝트 멤버 설정 통합"
```

---

### Task 6: Final Verification

**Files:**
- Verify: all changed files
- No source edits expected unless verification exposes a concrete failure

**Interfaces:**
- Consumes: all completed tasks.
- Produces: a branch ready for merge review.

- [ ] **Step 1: Run focused API tests**

Run: `npm run test --workspace @trace/api -- src/store/store-contract.test.ts src/routes/admin.test.ts`

Expected: PASS.

- [ ] **Step 2: Run focused Admin UI tests**

Run: `npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx src/App.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run full typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Check whitespace**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 6: Review final diff**

Run: `git status --short` and `git diff --stat HEAD`

Expected: only files listed in this plan have changed, with commits for store, API listing, API add, settings UI, App integration, and final fixes if any.

- [ ] **Step 7: Commit verification fix if needed**

If a verification command exposes a concrete issue, fix the smallest affected source or test file, rerun the failed command and any related focused command, then commit:

```bash
git add <affected-files>
git commit -m "관리자: 프로젝트 멤버 검증 수정"
```

If every verification command passes without source edits, do not create an empty commit.
