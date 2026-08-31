import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createAdminSessionForUser } from "../auth/session.js";
import type { AdminAuthConfig } from "../auth/config.js";
import { MemoryStore } from "../store/memory-store.js";

const authConfig: AdminAuthConfig = {
  googleClientId: "client.apps.googleusercontent.com",
  googleClientSecret: "client_secret",
  googleRedirectUri: "http://localhost:4000/auth/google/callback",
  adminAppOrigin: "http://localhost:5173",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  cookieSecure: false,
  allowedEmails: new Set(["admin@example.com"]),
  sessionTtlSeconds: 28800,
  loginRateLimitWindowSeconds: 300,
  loginRateLimitMax: 20,
  oauthCookieName: "__trace_oauth",
  sessionCookieName: "__trace_admin_session",
  csrfCookieName: "__trace_csrf",
};

async function signedInStore() {
  const store = new MemoryStore();
  const user = await store.upsertAdminUserFromGoogle({
    googleSub: "google_sub_1",
    email: "admin@example.com",
    emailVerified: true,
    now: "2026-08-25T00:00:00.000Z",
  });
  // 세션 만료는 라우트 핸들러가 실제 시계로 판정한다. app.inject 경로에는 now 를
  // 주입할 수 없으므로 세션도 실제 시각으로 발급한다. 고정 날짜로 만들면 TTL 이
  // 지나는 순간부터 모든 요청이 401 이 된다.
  const session = await createAdminSessionForUser({ store, config: authConfig, user });
  return { store, user, cookie: `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`, csrfToken: session.csrfToken };
}

class SaveTimeDuplicateStore extends MemoryStore {
  targetAdminUserId: string | undefined;

  override async getProjectMembership(projectId: string, adminUserId: string) {
    if (adminUserId === this.targetAdminUserId) return undefined;
    return super.getProjectMembership(projectId, adminUserId);
  }

  override async addProjectMembershipWithAudit(): Promise<never> {
    throw new Error("project_member_exists");
  }
}

class LastOwnerStore extends MemoryStore {
  throwLastOwnerBeforeNextUpdate = false;
  throwLastOwnerBeforeNextRemoval = false;

  override async updateProjectMembershipRoleWithAudit(input: Parameters<MemoryStore["updateProjectMembershipRoleWithAudit"]>[0]) {
    if (this.throwLastOwnerBeforeNextUpdate) throw new Error("last_owner_forbidden");
    return super.updateProjectMembershipRoleWithAudit(input);
  }

  override async removeProjectMembershipWithAudit(input: Parameters<MemoryStore["removeProjectMembershipWithAudit"]>[0]) {
    if (this.throwLastOwnerBeforeNextRemoval) throw new Error("last_owner_forbidden");
    return super.removeProjectMembershipWithAudit(input);
  }
}

class RequesterRoleRaceStore extends MemoryStore {
  otherOwnerAdminUserId: string | undefined;
  demoteRequesterBeforeNextUpdate = false;
  demoteRequesterBeforeNextRemoval = false;

  override async updateProjectMembershipRoleWithAudit(input: Parameters<MemoryStore["updateProjectMembershipRoleWithAudit"]>[0]) {
    if (this.demoteRequesterBeforeNextUpdate) {
      this.demoteRequesterBeforeNextUpdate = false;
      await super.updateProjectMembershipRoleWithAudit({
        projectId: input.projectId,
        targetAdminUserId: input.requestedByAdminUserId,
        requestedByAdminUserId: this.otherOwnerAdminUserId!,
        role: "viewer",
      });
    }
    return super.updateProjectMembershipRoleWithAudit(input);
  }

  override async removeProjectMembershipWithAudit(input: Parameters<MemoryStore["removeProjectMembershipWithAudit"]>[0]) {
    if (this.demoteRequesterBeforeNextRemoval) {
      this.demoteRequesterBeforeNextRemoval = false;
      await super.updateProjectMembershipRoleWithAudit({
        projectId: input.projectId,
        targetAdminUserId: input.requestedByAdminUserId,
        requestedByAdminUserId: this.otherOwnerAdminUserId!,
        role: "viewer",
      });
    }
    return super.removeProjectMembershipWithAudit(input);
  }
}

class TargetRoleRaceStore extends MemoryStore {
  promoteTargetBeforeNextUpdate = false;
  promoteTargetBeforeNextRemoval = false;

  override async updateProjectMembershipRoleWithAudit(input: Parameters<MemoryStore["updateProjectMembershipRoleWithAudit"]>[0]) {
    if (this.promoteTargetBeforeNextUpdate) {
      this.promoteTargetBeforeNextUpdate = false;
      await super.updateProjectMembershipRoleWithAudit({
        projectId: input.projectId,
        targetAdminUserId: input.targetAdminUserId,
        requestedByAdminUserId: input.requestedByAdminUserId,
        role: "admin",
      });
    }
    return super.updateProjectMembershipRoleWithAudit(input);
  }

  override async removeProjectMembershipWithAudit(input: Parameters<MemoryStore["removeProjectMembershipWithAudit"]>[0]) {
    if (this.promoteTargetBeforeNextRemoval) {
      this.promoteTargetBeforeNextRemoval = false;
      await super.updateProjectMembershipRoleWithAudit({
        projectId: input.projectId,
        targetAdminUserId: input.targetAdminUserId,
        requestedByAdminUserId: input.requestedByAdminUserId,
        role: "admin",
      });
    }
    return super.removeProjectMembershipWithAudit(input);
  }
}

describe("admin bff routes", () => {
  it("rejects Admin BFF requests without a session cookie", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig });
    const response = await app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/summary" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "admin_auth_required" });
  });

  it("creates a project and grants owner membership to the creator", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "POST",
      url: "/admin/api/projects",
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { name: "Demo SaaS", allowedDomains: ["https://demo.example.com"] },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.projectId).toMatch(/^proj_/);
    expect(await store.getProjectMembership(body.projectId, user.adminUserId)).toMatchObject({ role: "owner" });
    expect(await store.listAuditLogs()).toEqual([expect.objectContaining({
      adminUserId: user.adminUserId,
      action: "project.created",
      projectId: body.projectId,
      metadata: { name: "Demo SaaS" },
    })]);
  });

  it("normalizes allowed domains to origins when creating a project", async () => {
    const { store, cookie, csrfToken } = await signedInStore();
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "POST",
      url: "/admin/api/projects",
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: {
        name: "Demo SaaS",
        allowedDomains: ["http://localhost:5174/", "https://demo.example.com/path?utm=1"],
      },
    });

    expect(response.statusCode).toBe(201);
    const project = await store.getProject(response.json().projectId);
    expect(project?.allowedDomains).toEqual(["http://localhost:5174", "https://demo.example.com"]);
  });

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

  it.each(["owner", "admin", "viewer"] as const)("lets a %s list project members", async (role) => {
    const { store, user, cookie } = await signedInStore();
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
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        adminUserId: user.adminUserId,
        email: "admin@example.com",
        role,
        createdAt: "2026-08-27T00:00:00.000Z",
      },
    ]);
  });

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

  it("translates a save-time duplicate membership rejection to a conflict", async () => {
    const store = new SaveTimeDuplicateStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_owner",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user });
    const target = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_target",
      email: "target@example.com",
      emailVerified: true,
      now: "2026-08-25T00:01:00.000Z",
    });
    store.targetAdminUserId = target.adminUserId;
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
    const cookie = `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`;
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "POST",
      url: `/admin/api/projects/${project.projectId}/members`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": session.csrfToken },
      payload: { email: target.email, role: "viewer" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "project_member_exists" });
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

  it("lets an owner update another project member role and audits the change", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const member = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_role_change", email: "role-change@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { role: "admin" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      adminUserId: member.adminUserId,
      email: "role-change@example.com",
      role: "admin",
      createdAt: "2026-08-31T00:01:00.000Z",
    });
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.member_role_updated",
        projectId: project.projectId,
        metadata: { targetAdminUserId: member.adminUserId, email: "role-change@example.com", beforeRole: "viewer", afterRole: "admin" },
      }),
    ]));
  });

  it("lets an owner promote another project member to owner", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const member = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_promote", email: "promote@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { role: "owner" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ adminUserId: member.adminUserId, role: "owner" });
  });

  it("returns the current member and does not audit when the requested role is unchanged", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const member = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_unchanged", email: "unchanged@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    const auditCount = (await store.listAuditLogs()).length;
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { role: "viewer" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ adminUserId: member.adminUserId, role: "viewer" });
    expect((await store.listAuditLogs()).length).toBe(auditCount);
  });

  it("removes a project member and audits the removal", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const member = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_remove", email: "remove@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "DELETE",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
    });

    expect(response.statusCode).toBe(204);
    expect(await store.getProjectMembership(project.projectId, member.adminUserId)).toBeUndefined();
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.member_removed",
        projectId: project.projectId,
        metadata: { targetAdminUserId: member.adminUserId, email: "remove@example.com", role: "viewer" },
      }),
    ]));
  });

  it("rejects a requester demoted after the PATCH access check", async () => {
    const store = new RequesterRoleRaceStore();
    const user = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_update", email: "admin@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z" });
    const otherOwner = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_update_owner", email: "other-owner@example.com", emailVerified: true, now: "2026-08-31T00:01:00.000Z" });
    const member = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_update_member", email: "race-update@example.com", emailVerified: true, now: "2026-08-31T00:02:00.000Z" });
    const session = await createAdminSessionForUser({ store, config: authConfig, user });
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: otherOwner.adminUserId, role: "owner", createdAt: "2026-08-31T00:01:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:02:00.000Z" });
    store.otherOwnerAdminUserId = otherOwner.adminUserId;
    store.demoteRequesterBeforeNextUpdate = true;
    const app = createApp({ store, authConfig });
    const cookie = `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`;

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": session.csrfToken },
      payload: { role: "admin" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_role_forbidden" });
    expect(await store.getProjectMembership(project.projectId, member.adminUserId)).toMatchObject({ role: "viewer" });
  });

  it("rejects a requester demoted after the DELETE access check", async () => {
    const store = new RequesterRoleRaceStore();
    const user = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_remove", email: "admin@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z" });
    const otherOwner = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_remove_owner", email: "other-owner@example.com", emailVerified: true, now: "2026-08-31T00:01:00.000Z" });
    const member = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_remove_member", email: "race-remove@example.com", emailVerified: true, now: "2026-08-31T00:02:00.000Z" });
    const session = await createAdminSessionForUser({ store, config: authConfig, user });
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: otherOwner.adminUserId, role: "owner", createdAt: "2026-08-31T00:01:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:02:00.000Z" });
    store.otherOwnerAdminUserId = otherOwner.adminUserId;
    store.demoteRequesterBeforeNextRemoval = true;
    const app = createApp({ store, authConfig });
    const cookie = `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`;

    const response = await app.inject({
      method: "DELETE",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": session.csrfToken },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_role_forbidden" });
    expect(await store.getProjectMembership(project.projectId, member.adminUserId)).toMatchObject({ role: "viewer" });
  });

  it("uses the mutation-time member role in PATCH audit metadata", async () => {
    const store = new TargetRoleRaceStore();
    const user = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_audit_update", email: "admin@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z" });
    const member = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_audit_update_member", email: "race-audit-update@example.com", emailVerified: true, now: "2026-08-31T00:01:00.000Z" });
    const session = await createAdminSessionForUser({ store, config: authConfig, user });
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    store.promoteTargetBeforeNextUpdate = true;
    const app = createApp({ store, authConfig });
    const cookie = `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`;

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": session.csrfToken },
      payload: { role: "owner" },
    });

    expect(response.statusCode).toBe(200);
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ beforeRole: "admin", afterRole: "owner" }) }),
    ]));
  });

  it("uses the mutation-time member role in DELETE audit metadata", async () => {
    const store = new TargetRoleRaceStore();
    const user = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_audit_remove", email: "admin@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z" });
    const member = await store.upsertAdminUserFromGoogle({ googleSub: "google_sub_race_audit_remove_member", email: "race-audit-remove@example.com", emailVerified: true, now: "2026-08-31T00:01:00.000Z" });
    const session = await createAdminSessionForUser({ store, config: authConfig, user });
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    store.promoteTargetBeforeNextRemoval = true;
    const app = createApp({ store, authConfig });
    const cookie = `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`;

    const response = await app.inject({
      method: "DELETE",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": session.csrfToken },
    });

    expect(response.statusCode).toBe(204);
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ role: "admin" }) }),
    ]));
  });

  it.each(["admin", "viewer"] as const)("rejects %s members from changing or removing project members", async (role) => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const member = await store.upsertAdminUserFromGoogle({
      googleSub: `google_sub_forbidden_${role}`, email: `${role}-target@example.com`, emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role, createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    const app = createApp({ store, authConfig });
    const headers = { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken };

    const update = await app.inject({ method: "PATCH", url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`, headers, payload: { role: "admin" } });
    const remove = await app.inject({ method: "DELETE", url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`, headers });

    expect(update.statusCode).toBe(403);
    expect(update.json()).toEqual({ error: "project_role_forbidden" });
    expect(remove.statusCode).toBe(403);
    expect(remove.json()).toEqual({ error: "project_role_forbidden" });
  });

  it("rejects non-members from changing or removing project members", async () => {
    const { store, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const member = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_non_member_target", email: "non-member-target@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:00:00.000Z" });
    const app = createApp({ store, authConfig });
    const headers = { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken };

    const update = await app.inject({ method: "PATCH", url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`, headers, payload: { role: "admin" } });
    const remove = await app.inject({ method: "DELETE", url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`, headers });

    expect(update.statusCode).toBe(403);
    expect(update.json()).toEqual({ error: "project_access_denied" });
    expect(remove.statusCode).toBe(403);
    expect(remove.json()).toEqual({ error: "project_access_denied" });
  });

  it("rejects missing target members from changing or removing project members", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const missingAdminUserId = "admin_missing";
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    const app = createApp({ store, authConfig });
    const headers = { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken };

    const update = await app.inject({ method: "PATCH", url: `/admin/api/projects/${project.projectId}/members/${missingAdminUserId}`, headers, payload: { role: "admin" } });
    const remove = await app.inject({ method: "DELETE", url: `/admin/api/projects/${project.projectId}/members/${missingAdminUserId}`, headers });

    expect(update.statusCode).toBe(404);
    expect(update.json()).toEqual({ error: "project_member_not_found" });
    expect(remove.statusCode).toBe(404);
    expect(remove.json()).toEqual({ error: "project_member_not_found" });
  });

  it("rejects invalid project member roles", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const member = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_invalid_role", email: "invalid-role@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`,
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: { role: "invalid" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_project_member" });
  });

  it("rejects self owner demotion and removal", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const otherOwner = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_self_owner", email: "self-owner@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: otherOwner.adminUserId, role: "owner", createdAt: "2026-08-31T00:01:00.000Z" });
    const app = createApp({ store, authConfig });
    const headers = { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken };

    const demotion = await app.inject({ method: "PATCH", url: `/admin/api/projects/${project.projectId}/members/${user.adminUserId}`, headers, payload: { role: "admin" } });
    const removal = await app.inject({ method: "DELETE", url: `/admin/api/projects/${project.projectId}/members/${user.adminUserId}`, headers });

    expect(demotion.statusCode).toBe(403);
    expect(demotion.json()).toEqual({ error: "self_owner_change_forbidden" });
    expect(removal.statusCode).toBe(403);
    expect(removal.json()).toEqual({ error: "self_owner_change_forbidden" });
  });

  it("rejects last owner demotion and removal", async () => {
    const store = new LastOwnerStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_last_owner_requester", email: "admin@example.com", emailVerified: true, now: "2026-08-31T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user });
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    const member = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_last_owner", email: "last-owner@example.com", emailVerified: true, now: "2026-08-31T00:01:00.000Z",
    });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: user.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
    await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:01:00.000Z" });
    const app = createApp({ store, authConfig });
    const cookie = `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`;
    const headers = { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": session.csrfToken };

    store.throwLastOwnerBeforeNextUpdate = true;
    const demotion = await app.inject({ method: "PATCH", url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`, headers, payload: { role: "admin" } });
    store.throwLastOwnerBeforeNextRemoval = true;
    const removal = await app.inject({ method: "DELETE", url: `/admin/api/projects/${project.projectId}/members/${member.adminUserId}`, headers });

    expect(demotion.statusCode).toBe(403);
    expect(demotion.json()).toEqual({ error: "last_owner_forbidden" });
    expect(removal.statusCode).toBe(403);
    expect(removal.json()).toEqual({ error: "last_owner_forbidden" });
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

  it("returns 403 and audits when project settings are updated by a non-member", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({
      name: "Private",
      allowedDomains: ["https://private.example.com"],
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
    expect(response.json()).toEqual({ error: "project_access_denied" });
    expect(await store.getProject(project.projectId)).toMatchObject({
      name: "Private",
      allowedDomains: ["https://private.example.com"],
    });
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "project_settings" },
      }),
    ]));
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

  it("returns 403 when the signed-in admin lacks project membership", async () => {
    const { store, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Private", allowedDomains: ["https://private.example.com"] });
    const app = createApp({ store, authConfig });

    const response = await app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/summary`, headers: { cookie } });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_access_denied" });
  });

  it("audits every project membership denial", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Private", allowedDomains: ["https://private.example.com"] });
    await store.upsertIssues(project.projectId, [{
      issueId: "issue_private",
      projectId: project.projectId,
      issueType: "rage_click",
      title: "Private issue",
      summary: "Private issue summary.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 70,
      firstSeenAt: "2026-08-25T00:00:00.000Z",
      lastSeenAt: "2026-08-25T00:00:00.000Z",
      trend: "flat",
      relatedUrlPath: "/private",
      exampleSessionIds: ["sess_private"],
      status: "new",
    }]);
    const app = createApp({ store, authConfig });

    const responses = await Promise.all([
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/summary`, headers: { cookie } }),
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/issues`, headers: { cookie } }),
      app.inject({ method: "GET", url: `/admin/api/issues/issue_private?projectId=${project.projectId}`, headers: { cookie } }),
      app.inject({ method: "GET", url: `/admin/api/sessions/sess_private/timeline?projectId=${project.projectId}`, headers: { cookie } }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "project_summary" },
      }),
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "project_issues" },
      }),
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "issue_detail" },
      }),
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "session_timeline" },
      }),
    ]));
  });

  it("does not leak issue detail or session timeline across project scope", async () => {
    const { store, user, cookie } = await signedInStore();
    const memberProject = await store.createProject({ name: "Member", allowedDomains: ["https://member.example.com"] });
    const otherProject = await store.createProject({ name: "Other", allowedDomains: ["https://other.example.com"] });
    await store.addProjectMembership({
      projectId: memberProject.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    await store.saveBatch({
      projectId: memberProject.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-08-25T00:00:03.000Z",
      sdkVersion: "0.1.0",
      url: "https://member.example.com/settings",
      events: [{
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-08-25T00:00:00.000Z",
        type: "click",
        urlPath: "/settings",
        metadata: {},
      }],
    });
    await store.upsertIssues(memberProject.projectId, [{
      issueId: "issue_1",
      projectId: memberProject.projectId,
      issueType: "rage_click",
      title: "설정 화면에서 반복 클릭",
      summary: "같은 버튼을 반복 클릭했습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 70,
      firstSeenAt: "2026-08-25T00:00:00.000Z",
      lastSeenAt: "2026-08-25T00:00:00.000Z",
      trend: "flat",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new",
    }]);
    const app = createApp({ store, authConfig });

    const issueResponse = await app.inject({
      method: "GET",
      url: `/admin/api/issues/issue_1?projectId=${otherProject.projectId}`,
      headers: { cookie },
    });
    const timelineResponse = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_1/timeline?projectId=${otherProject.projectId}`,
      headers: { cookie },
    });

    expect(issueResponse.statusCode).toBe(404);
    expect(timelineResponse.statusCode).toBe(403);
  });
});
