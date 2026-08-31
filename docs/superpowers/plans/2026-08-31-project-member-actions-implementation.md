# Project Member Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 설정 화면에서 owner가 기존 프로젝트 멤버의 역할을 변경하거나 제거할 수 있게 하고, 서버가 자기 자신 owner 권한 상실과 마지막 owner 상실을 차단한다.

**Architecture:** 권한과 불변 조건은 Store 원자 구간에서 최종 강제하고, Admin BFF는 인증, CSRF, 프로젝트 접근권한, 요청 schema, HTTP 오류 변환을 담당한다. Admin UI는 `ProjectSettingsPage` row action과 `App.tsx` settings 상태 전이로 성공 시 즉시 목록을 갱신하고 실패 시 기존 목록을 유지한다.

**Tech Stack:** TypeScript, Fastify, Zod, better-sqlite3, React, Vitest, Testing Library

## Global Constraints

- 기본 커뮤니케이션, 사용자-facing copy, commit message는 한국어를 사용한다.
- 역할 변경은 `owner`, `admin`, `viewer`를 모두 대상으로 허용한다.
- 역할 변경/제거는 `owner`만 수행할 수 있다.
- 본인 제거와 본인 owner 권한 강등을 금지한다.
- 마지막 owner 제거와 마지막 owner 강등을 금지한다.
- 새 API는 기존 Admin BFF 아래에 두고 기존 인증/CSRF 규칙을 따른다.
- DB schema 변경은 없다.
- 기존 멤버 목록 응답 shape는 바꾸지 않는다.

---

## File Structure

- `apps/api/src/store/types.ts`: `TraceStore`에 멤버 역할 변경과 제거 메서드 계약을 추가한다.
- `apps/api/src/store/memory-store.ts`: 메모리 스토어에서 self owner loss, last owner loss, 동일 역할, audit 저장 규칙을 구현한다.
- `apps/api/src/store/sqlite-store.ts`: SQLite transaction으로 대상 조회, owner 수 검사, update/delete, audit insert를 원자 처리한다.
- `apps/api/src/store/store-contract.test.ts`: MemoryStore와 SqliteStore 공통 계약으로 새 스토어 메서드를 검증한다.
- `apps/api/src/routes/admin.ts`: 역할 변경 body schema를 추가한다.
- `apps/api/src/routes/admin-proxy.ts`: `PATCH /admin/api/projects/:projectId/members/:adminUserId`, `DELETE /admin/api/projects/:projectId/members/:adminUserId` route를 추가한다.
- `apps/api/src/routes/admin.test.ts`: API 권한, 오류, audit metadata, 동일 역할 no-audit 동작을 검증한다.
- `apps/admin/src/api.ts`: 멤버 역할 변경과 제거 client 함수를 추가한다.
- `apps/admin/src/pages/ProjectSettingsPage.tsx`: owner 전용 row select와 제거 버튼, 비활성 조건, 메시지 표시를 추가한다.
- `apps/admin/src/pages/ProjectSettingsPage.test.tsx`: row action 렌더링과 이벤트를 검증한다.
- `apps/admin/src/App.tsx`: 현재 admin user id, row in-flight, 성공/오류 메시지, stale response guard를 추가한다.
- `apps/admin/src/App.test.tsx`: App 통합 상태 전이와 stale response 무시를 검증한다.

---

### Task 1: Store Membership Mutation Contract

**Files:**
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: existing `AdminRole`, `ProjectMembershipRecord`, `CreateAuditLogInput`, `TraceStore.createAuditLog`, `TraceStore.listAuditLogs`, `TraceStore.listProjectMemberships`.
- Produces:

```ts
updateProjectMembershipRoleWithAudit(input: {
  projectId: string;
  targetAdminUserId: string;
  requestedByAdminUserId: string;
  role: AdminRole;
  auditLog?: CreateAuditLogInput;
}): Promise<ProjectMembershipRecord | undefined>;

removeProjectMembershipWithAudit(input: {
  projectId: string;
  targetAdminUserId: string;
  requestedByAdminUserId: string;
  auditLog: CreateAuditLogInput;
}): Promise<boolean>;
```

- Store-thrown errors use exact messages: `self_owner_change_forbidden`, `last_owner_forbidden`.

- [ ] **Step 1: Write failing store contract tests**

Add tests inside `describeTraceStoreContract` near existing project membership tests. Use the existing `open()`, `upsertAdminUserFromGoogle`, `createProject`, `addProjectMembership`, and `listAuditLogs` patterns so both MemoryStore and SqliteStore pass the same contract.

```ts
it("updates a project member role with audit and keeps createdAt", async () => {
  const store = open();
  const owner = await store.upsertAdminUserFromGoogle({
    email: "owner-role-update@example.com",
    name: "Owner",
    googleSub: "owner-role-update",
    emailVerified: true,
    now: "2026-08-31T00:00:00.000Z",
  });
  const member = await store.upsertAdminUserFromGoogle({
    email: "member-role-update@example.com",
    name: "Member",
    googleSub: "member-role-update",
    emailVerified: true,
    now: "2026-08-31T00:00:01.000Z",
  });
  const project = await store.createProject({ name: "Role Update", allowedDomains: [] });

  await store.addProjectMembership({
    projectId: project.projectId,
    adminUserId: owner.adminUserId,
    role: "owner",
  });
  const created = await store.addProjectMembership({
    projectId: project.projectId,
    adminUserId: member.adminUserId,
    role: "viewer",
  });

  const updated = await store.updateProjectMembershipRoleWithAudit({
    projectId: project.projectId,
    targetAdminUserId: member.adminUserId,
    requestedByAdminUserId: owner.adminUserId,
    role: "admin",
    auditLog: {
      adminUserId: owner.adminUserId,
      projectId: project.projectId,
      createdAt: "2026-08-31T00:00:00.000Z",
      action: "project.member_role_updated",
      metadata: {
        targetAdminUserId: member.adminUserId,
        email: member.email,
        beforeRole: "viewer",
        afterRole: "admin",
      },
    },
  });

  expect(updated).toEqual({
    projectId: project.projectId,
    adminUserId: member.adminUserId,
    role: "admin",
    createdAt: created.createdAt,
  });
  expect(await store.listAuditLogs()).toEqual([
    expect.objectContaining({
      action: "project.member_role_updated",
      metadata: {
        targetAdminUserId: member.adminUserId,
        email: member.email,
        beforeRole: "viewer",
        afterRole: "admin",
      },
    }),
  ]);
});
```

Add focused tests with these names and assertions:

```ts
it("returns the current member without audit when role is unchanged", async () => {
  // Arrange one owner and one viewer, call updateProjectMembershipRoleWithAudit with role "viewer" and no auditLog.
  // Assert returned member equals existing membership and listAuditLogs() is [].
});

it("returns undefined when updating a missing project member", async () => {
  // Arrange project and owner, call updateProjectMembershipRoleWithAudit for a missing adminUserId.
  // Assert the result is undefined and listAuditLogs() is [].
});

it("removes a project member with audit", async () => {
  // Arrange owner and viewer, call removeProjectMembershipWithAudit for the viewer.
  // Assert result is true, listProjectMemberships(projectId) only contains owner, and audit action is project.member_removed.
});

it("returns false when removing a missing project member", async () => {
  // Arrange project and owner, call removeProjectMembershipWithAudit for a missing adminUserId.
  // Assert result is false and listAuditLogs() is [].
});

it("rejects self owner demotion and removal without mutation or audit", async () => {
  // Arrange owner and another owner, try to demote requestedByAdminUserId to "admin" and remove requestedByAdminUserId.
  // Assert both reject with self_owner_change_forbidden, memberships stay unchanged, audit logs stay [].
});

it("rejects last owner demotion and removal without mutation or audit", async () => {
  // Arrange one owner and one viewer, try to demote the only owner and remove the only owner.
  // Assert both reject with last_owner_forbidden, memberships stay unchanged, audit logs stay [].
});
```

- [ ] **Step 2: Run store tests and verify failure**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: FAIL because `TraceStore` and concrete stores do not implement `updateProjectMembershipRoleWithAudit` and `removeProjectMembershipWithAudit`.

- [ ] **Step 3: Add TraceStore method signatures**

In `apps/api/src/store/types.ts`, add the two signatures immediately after `addProjectMembershipWithAudit`.

```ts
  updateProjectMembershipRoleWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    role: AdminRole;
    auditLog?: CreateAuditLogInput;
  }): Promise<ProjectMembershipRecord | undefined>;
  removeProjectMembershipWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    auditLog: CreateAuditLogInput;
  }): Promise<boolean>;
```

- [ ] **Step 4: Implement MemoryStore**

In `apps/api/src/store/memory-store.ts`, add a private synchronous audit append helper so member mutation and audit insertion happen in one synchronous block.

```ts
  private appendAuditLog(input: CreateAuditLogInput): void {
    const auditLog: AuditLogRecord = {
      auditLogId: `audit_${nanoid(10)}`,
      adminUserId: input.adminUserId,
      projectId: input.projectId,
      action: input.action,
      metadata: input.metadata,
      createdAt: input.createdAt,
    };
    this.auditLogs.set(auditLog.auditLogId, auditLog);
  }
```

Update `createAuditLog` to call this helper:

```ts
  async createAuditLog(input: CreateAuditLogInput): Promise<void> {
    this.appendAuditLog(input);
  }
```

Add the mutation methods:

```ts
  async updateProjectMembershipRoleWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    role: AdminRole;
    auditLog?: CreateAuditLogInput;
  }): Promise<ProjectMembershipRecord | undefined> {
    const key = `${input.projectId}:${input.targetAdminUserId}`;
    const current = this.projectMemberships.get(key);
    if (!current) {
      return undefined;
    }
    if (current.role === input.role) {
      return current;
    }
    if (input.targetAdminUserId === input.requestedByAdminUserId && current.role === "owner") {
      throw new Error("self_owner_change_forbidden");
    }
    if (current.role === "owner" && input.role !== "owner" && this.ownerCount(input.projectId) <= 1) {
      throw new Error("last_owner_forbidden");
    }

    const updated: ProjectMembershipRecord = {
      projectId: current.projectId,
      adminUserId: current.adminUserId,
      role: input.role,
      createdAt: current.createdAt,
    };
    this.projectMemberships.set(key, updated);
    if (input.auditLog) {
      this.appendAuditLog(input.auditLog);
    }
    return updated;
  }

  async removeProjectMembershipWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    auditLog: CreateAuditLogInput;
  }): Promise<boolean> {
    const key = `${input.projectId}:${input.targetAdminUserId}`;
    const current = this.projectMemberships.get(key);
    if (!current) {
      return false;
    }
    if (input.targetAdminUserId === input.requestedByAdminUserId) {
      throw new Error("self_owner_change_forbidden");
    }
    if (current.role === "owner" && this.ownerCount(input.projectId) <= 1) {
      throw new Error("last_owner_forbidden");
    }

    this.projectMemberships.delete(key);
    this.appendAuditLog(input.auditLog);
    return true;
  }
```

Add the helper:

```ts
  private ownerCount(projectId: string): number {
    return Array.from(this.projectMemberships.values()).filter(
      (membership) => membership.projectId === projectId && membership.role === "owner",
    ).length;
  }
```

- [ ] **Step 5: Implement SqliteStore**

In `apps/api/src/store/sqlite-store.ts`, add a private audit insert helper that existing `createAuditLog` and transaction methods can share.

```ts
  private insertAuditLog(input: CreateAuditLogInput): void {
    this.db.prepare(
      `INSERT INTO audit_logs (audit_log_id, admin_user_id, action, project_id, created_at, metadata)
       VALUES (@auditLogId, @adminUserId, @action, @projectId, @createdAt, @metadata)`,
    ).run({
      auditLogId: `audit_${nanoid(10)}`,
      adminUserId: input.adminUserId === undefined ? null : input.adminUserId,
      action: input.action,
      projectId: input.projectId === undefined ? null : input.projectId,
      createdAt: input.createdAt,
      metadata: JSON.stringify(input.metadata === undefined ? {} : input.metadata),
    });
  }
```

Add mutation methods using `this.db.transaction`.

```ts
  async updateProjectMembershipRoleWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    role: AdminRole;
    auditLog?: CreateAuditLogInput;
  }): Promise<ProjectMembershipRecord | undefined> {
    const run = this.db.transaction(() => {
      const current = this.getProjectMembershipSync(input.projectId, input.targetAdminUserId);
      if (!current) {
        return undefined;
      }
      if (current.role === input.role) {
        return current;
      }
      if (input.targetAdminUserId === input.requestedByAdminUserId && current.role === "owner") {
        throw new Error("self_owner_change_forbidden");
      }
      if (current.role === "owner" && input.role !== "owner" && this.ownerCountSync(input.projectId) <= 1) {
        throw new Error("last_owner_forbidden");
      }

      this.db.prepare(
        `UPDATE project_memberships
         SET role = @role
         WHERE project_id = @projectId AND admin_user_id = @adminUserId`,
      ).run({ role: input.role, projectId: input.projectId, adminUserId: input.targetAdminUserId });
      if (input.auditLog) {
        this.insertAuditLog(input.auditLog);
      }
      return this.getProjectMembershipSync(input.projectId, input.targetAdminUserId);
    });
    return run();
  }

  async removeProjectMembershipWithAudit(input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    auditLog: CreateAuditLogInput;
  }): Promise<boolean> {
    const run = this.db.transaction(() => {
      const current = this.getProjectMembershipSync(input.projectId, input.targetAdminUserId);
      if (!current) {
        return false;
      }
      if (input.targetAdminUserId === input.requestedByAdminUserId) {
        throw new Error("self_owner_change_forbidden");
      }
      if (current.role === "owner" && this.ownerCountSync(input.projectId) <= 1) {
        throw new Error("last_owner_forbidden");
      }

      this.db.prepare(
        `DELETE FROM project_memberships
         WHERE project_id = @projectId AND admin_user_id = @adminUserId`,
      ).run({ projectId: input.projectId, adminUserId: input.targetAdminUserId });
      this.insertAuditLog(input.auditLog);
      return true;
    });
    return run();
  }
```

Add private sync helpers if the file does not already have them.

```ts
  private getProjectMembershipSync(projectId: string, adminUserId: string): ProjectMembershipRecord | undefined {
    const row = this.db.prepare(
      `SELECT project_id, admin_user_id, role, created_at
       FROM project_memberships
       WHERE project_id = @projectId AND admin_user_id = @adminUserId`,
    ).get({ projectId, adminUserId }) as Row | undefined;
    return row ? this.toMembership(row) : undefined;
  }

  private ownerCountSync(projectId: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS count
       FROM project_memberships
       WHERE project_id = @projectId AND role = 'owner'`,
    ).get({ projectId }) as { count: number };
    return row.count;
  }
```

- [ ] **Step 6: Run store tests**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit store work**

```bash
git add apps/api/src/store/types.ts apps/api/src/store/memory-store.ts apps/api/src/store/sqlite-store.ts apps/api/src/store/store-contract.test.ts
git commit -m "관리자: 프로젝트 멤버 변경 제거 스토어 추가"
```

---

### Task 2: Admin API Member PATCH and DELETE

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: Task 1 `TraceStore.updateProjectMembershipRoleWithAudit`, `TraceStore.removeProjectMembershipWithAudit`.
- Produces:
  - `PATCH /admin/api/projects/:projectId/members/:adminUserId`
  - `DELETE /admin/api/projects/:projectId/members/:adminUserId`
  - export `updateProjectMemberRoleSchema`

- [ ] **Step 1: Write failing API tests**

In `apps/api/src/routes/admin.test.ts`, add tests near existing project member add/list tests. Use existing app factory, session, CSRF, project, and membership helpers. Cover these exact cases:

```ts
it("lets an owner update another project member role and audits the change", async () => {
  // Arrange owner and viewer memberships.
  // PATCH /admin/api/projects/:projectId/members/:adminUserId with { role: "admin" }.
  // Assert 200 response has role "admin" and original createdAt.
  // Assert audit action is project.member_role_updated with targetAdminUserId, email, beforeRole, afterRole.
});

it("lets an owner promote another project member to owner", async () => {
  // Arrange owner and viewer memberships.
  // PATCH with { role: "owner" }.
  // Assert 200 response has role "owner".
});

it("returns the current member and does not audit when the requested role is unchanged", async () => {
  // Arrange owner and viewer memberships.
  // Count audit logs before PATCH with { role: "viewer" }.
  // Assert 200 response has role "viewer" and audit log count is unchanged.
});

it("removes a project member and audits the removal", async () => {
  // Arrange owner and viewer memberships.
  // DELETE /admin/api/projects/:projectId/members/:adminUserId.
  // Assert 204 response, target membership is missing, audit action is project.member_removed.
});
```

Add rejection tests with exact expected body:

```ts
expect(response.statusCode).toBe(403);
expect(response.json()).toEqual({ error: "project_role_forbidden" });
```

Cover:
- admin requester update/delete returns `403 project_role_forbidden`
- viewer requester update/delete returns `403 project_role_forbidden`
- non-member update/delete returns `403 project_access_denied`
- missing target update/delete returns `404 project_member_not_found`
- invalid role update returns `400 invalid_project_member`
- self owner demotion returns `403 self_owner_change_forbidden`
- self removal returns `403 self_owner_change_forbidden`
- last owner demotion returns `403 last_owner_forbidden`
- last owner removal returns `403 last_owner_forbidden`

- [ ] **Step 2: Run API tests and verify failure**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts
```

Expected: FAIL with route/schema not found or 404 for the new endpoints.

- [ ] **Step 3: Add request schema**

In `apps/api/src/routes/admin.ts`, add:

```ts
export const updateProjectMemberRoleSchema = z.object({
  role: z.enum(["owner", "admin", "viewer"]),
});
```

- [ ] **Step 4: Add member params and error mapper**

In `apps/api/src/routes/admin-proxy.ts`, import `updateProjectMemberRoleSchema` and add:

```ts
const projectMemberParamsSchema = z.object({
  projectId: z.string(),
  adminUserId: z.string(),
});

function sendProjectMemberMutationError(reply: FastifyReply, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (message === "self_owner_change_forbidden") {
    return reply.code(403).send({ error: "self_owner_change_forbidden" });
  }
  if (message === "last_owner_forbidden") {
    return reply.code(403).send({ error: "last_owner_forbidden" });
  }
  throw error;
}
```

If `FastifyReply` is not currently imported, import it from `fastify`.

- [ ] **Step 5: Implement PATCH route**

Add the route inside `registerAdminProxyRoutes`, after the existing `POST /admin/api/projects/:projectId/members` route.

```ts
app.patch("/admin/api/projects/:projectId/members/:adminUserId", async (request, reply) => {
  const adminUser = await requireAdminSession(request, reply, options.config);
  if (!adminUser) {
    return;
  }
  if (!verifyCsrf(request, reply, options.config)) {
    return;
  }

  const params = projectMemberParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(404).send({ error: "project_not_found" });
  }
  const body = updateProjectMemberRoleSchema.safeParse(request.body);
  if (!body.success) {
    return reply.code(400).send({ error: "invalid_project_member" });
  }

  const access = await getProjectAccess(options.store, adminUser.adminUserId, params.data.projectId);
  if (access.status === "missing-project") {
    return reply.code(404).send({ error: "project_not_found" });
  }
  if (access.status === "not-member") {
    return reply.code(403).send({ error: "project_access_denied" });
  }
  if (access.membership.role !== "owner") {
    return reply.code(403).send({ error: "project_role_forbidden" });
  }

  const before = await options.store.getProjectMembership(params.data.projectId, params.data.adminUserId);
  if (!before) {
    return reply.code(404).send({ error: "project_member_not_found" });
  }
  const targetUser = await options.store.getAdminUser(params.data.adminUserId);
  if (!targetUser) {
    return reply.code(404).send({ error: "project_member_not_found" });
  }

  try {
    const updated = await options.store.updateProjectMembershipRoleWithAudit({
      projectId: params.data.projectId,
      targetAdminUserId: params.data.adminUserId,
      requestedByAdminUserId: adminUser.adminUserId,
      role: body.data.role,
      auditLog: before.role === body.data.role ? undefined : {
        adminUserId: adminUser.adminUserId,
        projectId: params.data.projectId,
        createdAt: new Date().toISOString(),
        action: "project.member_role_updated",
        metadata: {
          targetAdminUserId: targetUser.adminUserId,
          email: targetUser.email,
          beforeRole: before.role,
          afterRole: body.data.role,
        },
      },
    });
    if (!updated) {
      return reply.code(404).send({ error: "project_member_not_found" });
    }
    return reply.send(toProjectMemberResponse(updated, targetUser));
  } catch (error) {
    return sendProjectMemberMutationError(reply, error, "project_member_update_failed");
  }
});
```

- [ ] **Step 6: Implement DELETE route**

Add:

```ts
app.delete("/admin/api/projects/:projectId/members/:adminUserId", async (request, reply) => {
  const adminUser = await requireAdminSession(request, reply, options.config);
  if (!adminUser) {
    return;
  }
  if (!verifyCsrf(request, reply, options.config)) {
    return;
  }

  const params = projectMemberParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(404).send({ error: "project_not_found" });
  }
  const access = await getProjectAccess(options.store, adminUser.adminUserId, params.data.projectId);
  if (access.status === "missing-project") {
    return reply.code(404).send({ error: "project_not_found" });
  }
  if (access.status === "not-member") {
    return reply.code(403).send({ error: "project_access_denied" });
  }
  if (access.membership.role !== "owner") {
    return reply.code(403).send({ error: "project_role_forbidden" });
  }

  const before = await options.store.getProjectMembership(params.data.projectId, params.data.adminUserId);
  if (!before) {
    return reply.code(404).send({ error: "project_member_not_found" });
  }
  const targetUser = await options.store.getAdminUser(params.data.adminUserId);
  if (!targetUser) {
    return reply.code(404).send({ error: "project_member_not_found" });
  }

  try {
    const removed = await options.store.removeProjectMembershipWithAudit({
      projectId: params.data.projectId,
      targetAdminUserId: params.data.adminUserId,
      requestedByAdminUserId: adminUser.adminUserId,
      auditLog: {
        adminUserId: adminUser.adminUserId,
        projectId: params.data.projectId,
        createdAt: new Date().toISOString(),
        action: "project.member_removed",
        metadata: {
          targetAdminUserId: targetUser.adminUserId,
          email: targetUser.email,
          role: before.role,
        },
      },
    });
    if (!removed) {
      return reply.code(404).send({ error: "project_member_not_found" });
    }
    return reply.code(204).send();
  } catch (error) {
    return sendProjectMemberMutationError(reply, error, "project_member_remove_failed");
  }
});
```

- [ ] **Step 7: Run API tests**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit API work**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.test.ts
git commit -m "관리자: 프로젝트 멤버 변경 제거 API 추가"
```

---

### Task 3: Admin API Client and Settings Row UI

**Files:**
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/pages/ProjectSettingsPage.tsx`
- Test: `apps/admin/src/pages/ProjectSettingsPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 Admin BFF endpoints.
- Produces:

```ts
export async function updateProjectMemberRole(
  projectId: string,
  adminUserId: string,
  input: { role: ProjectRole },
  csrfToken: string,
): Promise<ProjectMemberResponse>;

export async function removeProjectMember(
  projectId: string,
  adminUserId: string,
  csrfToken: string,
): Promise<void>;
```

`ProjectSettingsPage` props add:

```ts
currentAdminUserId: string;
memberActionInFlight?: string | undefined;
memberActionError?: string | undefined;
memberActionSavedMessage?: string | undefined;
onUpdateMemberRole: (adminUserId: string, role: ProjectRole) => void;
onRemoveMember: (adminUserId: string) => void;
```

- [ ] **Step 1: Write failing Admin API client and page tests**

In `apps/admin/src/pages/ProjectSettingsPage.test.tsx`, update the `renderRequiredProps` helper to include `currentAdminUserId`, `onUpdateMemberRole`, and `onRemoveMember`.

Add tests:

```ts
it("renders owner-only member row actions", () => {
  // Render as project role owner with two members.
  // Assert each row has a role select and remove button.
});

it("hides member row actions from admins and viewers", () => {
  // Render with project.role "admin" and again with "viewer".
  // Assert role select and remove buttons are not present.
});

it("calls onUpdateMemberRole when owner changes a role select", () => {
  // Render owner view.
  // fireEvent.change(screen.getByLabelText("member@example.com 역할"), { target: { value: "admin" } }).
  // Assert handler called with member adminUserId and "admin".
});

it("does not call onRemoveMember when the owner cancels removal confirmation", () => {
  // Mock window.confirm to return false.
  // Click member remove button.
  // Assert onRemoveMember not called.
});

it("calls onRemoveMember after removal confirmation", () => {
  // Mock window.confirm to return true.
  // Click member remove button.
  // Assert onRemoveMember called with member adminUserId.
});

it("disables controls for the member action in flight", () => {
  // Render with memberActionInFlight equal to one member id.
  // Assert that row select and remove button are disabled.
});

it("disables self owner loss controls", () => {
  // Render owner row where member.adminUserId equals currentAdminUserId.
  // Assert remove button is disabled and admin/viewer options are disabled.
});

it("disables last owner loss controls", () => {
  // Render only one owner plus viewer.
  // Assert only owner row remove button is disabled and admin/viewer options are disabled.
});

it("renders member action error and success messages", () => {
  // Render with memberActionError and memberActionSavedMessage.
  // Assert both Korean messages are visible.
});
```

- [ ] **Step 2: Run page tests and verify failure**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx
```

Expected: FAIL because new props, controls, and messages are missing.

- [ ] **Step 3: Add Admin API client functions**

In `apps/admin/src/api.ts`, add:

```ts
export async function updateProjectMemberRole(
  projectId: string,
  adminUserId: string,
  input: { role: ProjectRole },
  csrfToken: string,
): Promise<ProjectMemberResponse> {
  const response = await ensureSuccess(`/admin/api/projects/${projectId}/members/${adminUserId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-trace-csrf": csrfToken },
    body: JSON.stringify(input),
  });

  return response.json() as Promise<ProjectMemberResponse>;
}

export async function removeProjectMember(
  projectId: string,
  adminUserId: string,
  csrfToken: string,
): Promise<void> {
  await ensureSuccess(`/admin/api/projects/${projectId}/members/${adminUserId}`, {
    method: "DELETE",
    headers: { "x-trace-csrf": csrfToken },
  });
}
```

- [ ] **Step 4: Extend ProjectSettingsPage props**

In `apps/admin/src/pages/ProjectSettingsPage.tsx`, import `ProjectRole` and add the new props to `ProjectSettingsPageProps`.

```ts
  currentAdminUserId: string;
  memberActionInFlight?: string | undefined;
  memberActionError?: string | undefined;
  memberActionSavedMessage?: string | undefined;
  onUpdateMemberRole: (adminUserId: string, role: ProjectRole) => void;
  onRemoveMember: (adminUserId: string) => void;
```

- [ ] **Step 5: Render owner-only row actions**

Inside the member list map, compute:

```ts
const ownerCount = members.filter((member) => member.role === "owner").length;
```

For each member row:

```ts
const actionBusy = memberActionInFlight === member.adminUserId;
const isSelf = member.adminUserId === currentAdminUserId;
const isLastOwner = member.role === "owner" && ownerCount === 1;
const ownerLossDisabled = member.role === "owner" && (isSelf || isLastOwner);
const removeDisabled = actionBusy || isSelf || isLastOwner;
```

Render controls only when `project.role === "owner"`:

```tsx
<div className="member-row-actions">
  <label className="sr-only" htmlFor={`member-role-${member.adminUserId}`}>
    {member.email} 역할
  </label>
  <select
    id={`member-role-${member.adminUserId}`}
    value={member.role}
    disabled={actionBusy}
    onChange={(event) => {
      const nextRole = event.target.value as ProjectRole;
      if (nextRole !== member.role) {
        onUpdateMemberRole(member.adminUserId, nextRole);
      }
    }}
  >
    <option value="owner">소유자</option>
    <option value="admin" disabled={ownerLossDisabled}>관리자</option>
    <option value="viewer" disabled={ownerLossDisabled}>조회자</option>
  </select>
  <button
    type="button"
    className="secondary-button"
    disabled={removeDisabled}
    onClick={() => {
      if (window.confirm("이 멤버를 프로젝트에서 제거할까요?")) {
        onRemoveMember(member.adminUserId);
      }
    }}
  >
    제거
  </button>
</div>
```

Add section-level rendering for `memberActionError` and `memberActionSavedMessage`. Keep existing `memberError` and `memberSavedMessage` for add member flow.

- [ ] **Step 6: Add compact styling**

Use existing CSS file if `ProjectSettingsPage` styles live in `apps/admin/src/App.css`. Add a compact row action layout that does not introduce nested cards:

```css
.member-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.member-row-actions select {
  min-width: 104px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Add `apps/admin/src/App.css` to this task if the class names need styling there.

- [ ] **Step 7: Run page tests**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit UI component work**

```bash
git add apps/admin/src/api.ts apps/admin/src/pages/ProjectSettingsPage.tsx apps/admin/src/pages/ProjectSettingsPage.test.tsx apps/admin/src/App.css
git commit -m "관리자: 프로젝트 멤버 행 액션 UI 추가"
```

---

### Task 4: App Settings State Integration

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Test: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 `updateProjectMemberRole`, `removeProjectMember`, `ProjectSettingsPage` props.
- Produces:
  - settings state includes `currentAdminUserId`, `memberActionInFlight`, `memberActionError`, `memberActionSavedMessage`.
  - handlers `handleUpdateMemberRole(adminUserId: string, role: ProjectRole)` and `handleRemoveMember(adminUserId: string)`.

- [ ] **Step 1: Write failing App tests**

In `apps/admin/src/App.test.tsx`, extend API mocks:

```ts
updateProjectMemberRole: vi.fn(),
removeProjectMember: vi.fn(),
```

Add default resolved values in `beforeEach`.

```ts
api.updateProjectMemberRole.mockResolvedValue({
  adminUserId: "admin_member",
  email: "member@example.com",
  name: "Member",
  role: "admin",
  createdAt: "2026-08-28T00:00:00.000Z",
});
api.removeProjectMember.mockResolvedValue(undefined);
```

Add tests:

```ts
it("updates a project member role from settings", async () => {
  // Open settings with owner and viewer members.
  // Change member role select to admin.
  // Assert updateProjectMemberRole called with projectId, adminUserId, { role: "admin" }, csrfToken.
  // Assert "멤버 역할을 변경했습니다." and updated role label are visible.
});

it("keeps member list and shows an error when role update fails", async () => {
  // Mock updateProjectMemberRole rejected with new ApiError(403, "last_owner_forbidden").
  // Change owner role select to admin.
  // Assert "마지막 소유자는 변경하거나 제거할 수 없습니다." is visible and original role remains.
});

it("removes a project member from settings", async () => {
  // Mock window.confirm true.
  // Click remove on viewer member.
  // Assert removeProjectMember called with projectId, adminUserId, csrfToken.
  // Assert "멤버를 제거했습니다." and removed email is not visible.
});

it("keeps member list and shows an error when removal fails", async () => {
  // Mock removeProjectMember rejected with new ApiError(403, "self_owner_change_forbidden").
  // Click remove on current owner if button is enabled in the test setup, otherwise invoke another failing row.
  // Assert "내 소유자 권한은 직접 변경할 수 없습니다." and member email remains visible.
});

it("ignores delayed member role responses after leaving settings", async () => {
  // Make updateProjectMemberRole return a manually resolved promise.
  // Start update, click back to dashboard, resolve promise.
  // Assert settings success message does not appear and dashboard remains visible.
});

it("ignores delayed member removal responses after logout", async () => {
  // Make removeProjectMember return a manually resolved promise.
  // Start removal, log out, resolve promise.
  // Assert logged-out screen remains visible.
});
```

- [ ] **Step 2: Run App tests and verify failure**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: FAIL because App state and handlers are missing.

- [ ] **Step 3: Add current admin user id to ready and settings state**

In `apps/admin/src/App.tsx`, extend state types that currently carry `userEmail` to also carry `adminUserId`. On successful auth/session load, set `adminUserId` from `auth.user.adminUserId`.

When entering settings in `handleShowSettings`, carry:

```ts
currentAdminUserId: previous.adminUserId,
memberActionInFlight: undefined,
memberActionError: undefined,
memberActionSavedMessage: undefined,
```

Pass `currentAdminUserId` to `ProjectSettingsPage`.

- [ ] **Step 4: Add error mapping helpers**

Add helpers near existing add-member error mapping:

```ts
function memberRoleUpdateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "project_role_forbidden") return "멤버를 관리할 권한이 없습니다.";
    if (error.code === "project_member_not_found") return "멤버를 찾을 수 없습니다.";
    if (error.code === "last_owner_forbidden") return "마지막 소유자는 변경하거나 제거할 수 없습니다.";
    if (error.code === "self_owner_change_forbidden") return "내 소유자 권한은 직접 변경할 수 없습니다.";
    if (error.code === "invalid_project_member") return "멤버 역할이 올바르지 않습니다.";
    if (error.code === "csrf_origin_invalid" || error.code === "csrf_token_invalid") {
      return "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.";
    }
  }
  return "멤버를 변경하지 못했습니다.";
}

function memberRemoveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "project_role_forbidden") return "멤버를 관리할 권한이 없습니다.";
    if (error.code === "project_member_not_found") return "멤버를 찾을 수 없습니다.";
    if (error.code === "last_owner_forbidden") return "마지막 소유자는 변경하거나 제거할 수 없습니다.";
    if (error.code === "self_owner_change_forbidden") return "내 소유자 권한은 직접 변경할 수 없습니다.";
    if (error.code === "csrf_origin_invalid" || error.code === "csrf_token_invalid") {
      return "보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.";
    }
  }
  return "멤버를 제거하지 못했습니다.";
}
```

- [ ] **Step 5: Implement role update handler**

Add:

```ts
async function handleUpdateMemberRole(adminUserId: string, role: ProjectRole) {
  if (state.type !== "settings") {
    return;
  }
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
      if (current.type !== "settings" || current.projectId !== projectId) {
        return current;
      }
      return Object.assign({}, current, {
        members: current.members.map((member) => member.adminUserId === updated.adminUserId ? updated : member),
        memberActionInFlight: undefined,
        memberActionError: undefined,
        memberActionSavedMessage: "멤버 역할을 변경했습니다.",
      });
    });
  } catch (error) {
    setState((current) => {
      if (current.type !== "settings" || current.projectId !== projectId) {
        return current;
      }
      return Object.assign({}, current, {
        memberActionInFlight: undefined,
        memberActionError: memberRoleUpdateErrorMessage(error),
        memberActionSavedMessage: undefined,
      });
    });
  }
}
```

- [ ] **Step 6: Implement member removal handler**

Add:

```ts
async function handleRemoveMember(adminUserId: string) {
  if (state.type !== "settings") {
    return;
  }
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
      if (current.type !== "settings" || current.projectId !== projectId) {
        return current;
      }
      return Object.assign({}, current, {
        members: current.members.filter((member) => member.adminUserId !== adminUserId),
        memberActionInFlight: undefined,
        memberActionError: undefined,
        memberActionSavedMessage: "멤버를 제거했습니다.",
      });
    });
  } catch (error) {
    setState((current) => {
      if (current.type !== "settings" || current.projectId !== projectId) {
        return current;
      }
      return Object.assign({}, current, {
        memberActionInFlight: undefined,
        memberActionError: memberRemoveErrorMessage(error),
        memberActionSavedMessage: undefined,
      });
    });
  }
}
```

- [ ] **Step 7: Wire ProjectSettingsPage props**

Where `ProjectSettingsPage` is rendered, pass:

```tsx
currentAdminUserId={state.currentAdminUserId}
memberActionInFlight={state.memberActionInFlight}
memberActionError={state.memberActionError}
memberActionSavedMessage={state.memberActionSavedMessage}
onUpdateMemberRole={(adminUserId, role) => { void handleUpdateMemberRole(adminUserId, role); }}
onRemoveMember={(adminUserId) => { void handleRemoveMember(adminUserId); }}
```

- [ ] **Step 8: Run App tests**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit App integration**

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "관리자: 프로젝트 멤버 변경 제거 상태 연결"
```

---

### Task 5: Final Verification and Branch Finish

**Files:**
- Verify only unless a previous task revealed a small fix.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified branch ready for merge.

- [ ] **Step 1: Run focused API tests**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts src/routes/admin.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused Admin tests**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test
```

Expected: PASS.

- [ ] **Step 5: Check whitespace and diff**

```bash
git diff --check
git status --short
git diff --stat HEAD
```

Expected: no whitespace errors; status only contains intentional implementation commits before merge.

- [ ] **Step 6: Commit final fixes if any**

If Step 1 through Step 5 required a small correction, commit only those files:

```bash
git status --short
git commit -m "관리자: 프로젝트 멤버 변경 제거 검증 보완"
```

- [ ] **Step 7: Finish branch**

After all tests pass and the working tree is clean, use `superpowers:finishing-a-development-branch` to decide whether to merge this branch into `main`, keep it for review, or hand off the final branch state.
