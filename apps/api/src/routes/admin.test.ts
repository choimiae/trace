import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@trace/shared";
import { createApp } from "../app.js";
import { createAdminSessionForUser } from "../auth/session.js";
import type { AdminAuthConfig } from "../auth/config.js";
import { elementKey } from "../detection/element-identity.js";
import { MemoryStore } from "../store/memory-store.js";

const authConfig: AdminAuthConfig = {
  googleClientId: "client.apps.googleusercontent.com",
  googleClientSecret: "client_secret",
  googleRedirectUri: "http://localhost:4000/auth/google/callback",
  adminAppOrigin: "http://localhost:5173",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  cookieSecure: false,
  allowedEmails: new Set(["admin@example.com"]),
  googleOAuthEnabled: true,
  localAdminLoginEnabled: false,
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

async function createAuthenticatedOwner() {
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
  const headers = { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken };
  return { app, store, project, headers };
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

class CountingAdminUserStore extends MemoryStore {
  getAdminUserCalls = 0;

  override async getAdminUser(adminUserId: string) {
    this.getAdminUserCalls += 1;
    return super.getAdminUser(adminUserId);
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
      replay: { enabled: false, maskSelectors: [] },
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

  it("lets an owner search member candidates with an empty query", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const outsider = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_candidate",
      email: "aaa-candidate@example.com",
      emailVerified: true,
      name: "Candidate",
      now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/member-candidates`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        adminUserId: outsider.adminUserId,
        email: "aaa-candidate@example.com",
        name: "Candidate",
      },
      {
        adminUserId: user.adminUserId,
        email: "admin@example.com",
        membership: { role: "owner" },
      },
    ]);
  });

  it("lets an owner search member candidates by email", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const outsider = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_other",
      email: "person@other.example.com",
      emailVerified: true,
      now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/member-candidates?query=other`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { adminUserId: outsider.adminUserId, email: "person@other.example.com" },
    ]);
  });

  it("lets an owner search member candidates by name", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const outsider = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_named",
      email: "named@example.com",
      emailVerified: true,
      name: "Alice Kim",
      now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/member-candidates?query=kim`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { adminUserId: outsider.adminUserId, email: "named@example.com", name: "Alice Kim" },
    ]);
  });

  it("trims and lowercases the member candidate search query", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const outsider = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_alice",
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice",
      now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/member-candidates?query=${encodeURIComponent("  ALICE  ")}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { adminUserId: outsider.adminUserId, email: "alice@example.com", name: "Alice" },
    ]);
  });

  it("applies the member candidate search limit", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_limit",
      email: "aaa-limit@example.com",
      emailVerified: true,
      now: "2026-08-31T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/member-candidates?limit=1`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { adminUserId: expect.any(String), email: "aaa-limit@example.com" },
    ]);
  });

  it.each(["admin", "viewer"] as const)(
    "rejects member candidate search from a %s member",
    async (role) => {
      const { store, user, cookie } = await signedInStore();
      const project = await store.createProject({
        name: `Demo ${role}`,
        allowedDomains: [`https://${role}.example.com`],
      });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: user.adminUserId,
        role,
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      const app = createApp({ store, authConfig });

      const response = await app.inject({
        method: "GET",
        url: `/admin/api/projects/${project.projectId}/member-candidates`,
        headers: { cookie },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "project_role_forbidden" });
    },
  );

  it("returns 403 and audits when member candidates are requested by a non-member", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Private",
      allowedDomains: ["https://private.example.com"],
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/member-candidates`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_access_denied" });
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "project_member_candidates" },
      }),
    ]));
  });

  it("returns 404 when searching member candidates for a missing project", async () => {
    const { store, cookie } = await signedInStore();
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: "/admin/api/projects/proj_missing/member-candidates",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });

  it("rejects member candidate search without a session cookie", async () => {
    const { store } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/member-candidates`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "admin_auth_required" });
  });

  it.each(["0", "51", "abc"])("rejects an out-of-range member candidate limit %s", async (limit) => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/member-candidates?limit=${limit}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_member_candidate_search" });
  });

  it("lets an owner read project audit logs newest first", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    await store.createAuditLog({
      adminUserId: user.adminUserId,
      action: "project.updated",
      projectId: project.projectId,
      createdAt: "2026-08-31T00:00:00.000Z",
      metadata: { i: 1 },
    });
    await store.createAuditLog({
      adminUserId: user.adminUserId,
      action: "project.updated",
      projectId: project.projectId,
      createdAt: "2026-08-31T01:00:00.000Z",
      metadata: { i: 2 },
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries.map((entry: { createdAt: string }) => entry.createdAt)).toEqual([
      "2026-08-31T01:00:00.000Z",
      "2026-08-31T00:00:00.000Z",
    ]);
    for (const entry of body.entries) {
      expect(entry.actor).toEqual({ adminUserId: user.adminUserId, email: "admin@example.com" });
    }
    expect(body).not.toHaveProperty("nextCursor");
  });

  it("resolves the actor name when the admin user has one", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    const namedActor = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_named_actor",
      email: "named-actor@example.com",
      emailVerified: true,
      name: "Named Actor",
      now: "2026-08-31T00:00:00.000Z",
    });
    await store.createAuditLog({
      adminUserId: namedActor.adminUserId,
      action: "project.updated",
      projectId: project.projectId,
      createdAt: "2026-08-31T00:00:00.000Z",
      metadata: {},
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toEqual([
      expect.objectContaining({
        actor: { adminUserId: namedActor.adminUserId, email: "named-actor@example.com", name: "Named Actor" },
      }),
    ]);
  });

  it("omits the actor when the audit log has no admin user", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    await store.createAuditLog({
      action: "project.updated",
      projectId: project.projectId,
      createdAt: "2026-08-31T00:00:00.000Z",
      metadata: {},
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).not.toHaveProperty("actor");
  });

  it("returns only the adminUserId when the actor no longer exists", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    await store.createAuditLog({
      adminUserId: "admin_missing",
      action: "project.updated",
      projectId: project.projectId,
      createdAt: "2026-08-31T00:00:00.000Z",
      metadata: {},
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].actor).toEqual({ adminUserId: "admin_missing" });
    expect(body.entries[0].actor).not.toHaveProperty("email");
  });

  it("paginates project audit logs with a cursor", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    for (let i = 0; i < 3; i += 1) {
      await store.createAuditLog({
        adminUserId: user.adminUserId,
        action: "project.updated",
        projectId: project.projectId,
        createdAt: `2026-08-31T0${i}:00:00.000Z`,
        metadata: { i },
      });
    }
    const app = createApp({ store, authConfig });

    const firstResponse = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs?limit=2`,
      headers: { cookie },
    });

    expect(firstResponse.statusCode).toBe(200);
    const firstBody = firstResponse.json();
    expect(firstBody.entries).toHaveLength(2);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const secondResponse = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: { cookie },
    });

    expect(secondResponse.statusCode).toBe(200);
    const secondBody = secondResponse.json();
    expect(secondBody.entries).toHaveLength(1);
    expect(secondBody).not.toHaveProperty("nextCursor");

    const firstIds = firstBody.entries.map((entry: { auditLogId: string }) => entry.auditLogId);
    const secondIds = secondBody.entries.map((entry: { auditLogId: string }) => entry.auditLogId);
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
  });

  it("excludes audit logs without a project and from other projects", async () => {
    const { store, user, cookie } = await signedInStore();
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
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    await store.createAuditLog({
      adminUserId: user.adminUserId,
      action: "project.updated",
      projectId: project.projectId,
      createdAt: "2026-08-31T00:00:00.000Z",
      metadata: { target: true },
    });
    await store.createAuditLog({
      adminUserId: user.adminUserId,
      action: "project.updated",
      projectId: otherProject.projectId,
      createdAt: "2026-08-31T00:01:00.000Z",
      metadata: { target: false },
    });
    await store.createAuditLog({
      adminUserId: user.adminUserId,
      action: "auth.login_success",
      createdAt: "2026-08-31T00:02:00.000Z",
      metadata: {},
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].metadata).toEqual({ target: true });
  });

  it("looks up each distinct actor only once per page", async () => {
    const store = new CountingAdminUserStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user });
    const cookie = `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`;
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    for (let i = 0; i < 3; i += 1) {
      await store.createAuditLog({
        adminUserId: user.adminUserId,
        action: "project.updated",
        projectId: project.projectId,
        createdAt: `2026-08-31T0${i}:00:00.000Z`,
        metadata: { i },
      });
    }
    const app = createApp({ store, authConfig });

    store.getAdminUserCalls = 0;
    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(store.getAdminUserCalls).toBe(1);
  });

  it.each(["admin", "viewer"] as const)(
    "rejects project audit log reads from a %s member",
    async (role) => {
      const { store, user, cookie } = await signedInStore();
      const project = await store.createProject({
        name: `Demo ${role}`,
        allowedDomains: [`https://${role}.example.com`],
      });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: user.adminUserId,
        role,
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      const app = createApp({ store, authConfig });

      const response = await app.inject({
        method: "GET",
        url: `/admin/api/projects/${project.projectId}/audit-logs`,
        headers: { cookie },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "project_role_forbidden" });
    },
  );

  it.each(["admin", "viewer"] as const)(
    "rejects an invalid audit log query from a %s member with a role error, not a validation error",
    async (role) => {
      const { store, user, cookie } = await signedInStore();
      const project = await store.createProject({
        name: `Demo ${role}`,
        allowedDomains: [`https://${role}.example.com`],
      });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: user.adminUserId,
        role,
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      const app = createApp({ store, authConfig });

      const response = await app.inject({
        method: "GET",
        url: `/admin/api/projects/${project.projectId}/audit-logs?limit=0`,
        headers: { cookie },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "project_role_forbidden" });
    },
  );

  it("returns 403 and audits when project audit logs are requested by a non-member", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Private",
      allowedDomains: ["https://private.example.com"],
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_access_denied" });
    expect(await store.listAuditLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adminUserId: user.adminUserId,
        action: "project.access_denied",
        projectId: project.projectId,
        metadata: { resourceType: "project_audit_logs" },
      }),
    ]));
  });

  it("returns 404 when reading audit logs for a missing project", async () => {
    const { store, cookie } = await signedInStore();
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: "/admin/api/projects/proj_missing/audit-logs",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });

  it("rejects project audit log reads without a session cookie", async () => {
    const { store } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "admin_auth_required" });
  });

  it.each(["0", "101", "abc"])("rejects an out-of-range audit log limit %s", async (limit) => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs?limit=${limit}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_audit_log_query" });
  });

  it.each(["nope", "|audit_1", "2026-08-31T00:00:00.000Z|"])(
    "rejects an invalid audit log cursor %s",
    async (cursor) => {
      const { store, user, cookie } = await signedInStore();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: user.adminUserId,
        role: "owner",
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      const app = createApp({ store, authConfig });

      const response = await app.inject({
        method: "GET",
        url: `/admin/api/projects/${project.projectId}/audit-logs?cursor=${encodeURIComponent(cursor)}`,
        headers: { cookie },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_audit_log_query" });
    },
  );

  it("returns exactly one entry when limit=1 is requested", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    await store.createAuditLog({
      adminUserId: user.adminUserId,
      action: "project.updated",
      projectId: project.projectId,
      createdAt: "2026-08-31T00:00:00.000Z",
      metadata: {},
    });
    await store.createAuditLog({
      adminUserId: user.adminUserId,
      action: "project.updated",
      projectId: project.projectId,
      createdAt: "2026-08-31T01:00:00.000Z",
      metadata: {},
    });
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/audit-logs?limit=1`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries).toHaveLength(1);
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
      replay: { enabled: false, maskSelectors: [] },
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
          before: {
            name: "Old",
            allowedDomains: ["https://old.example.com"],
            replay: { enabled: false, maskSelectors: [] },
          },
          after: {
            name: "New",
            allowedDomains: ["https://new.example.com"],
            replay: { enabled: false, maskSelectors: [] },
          },
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

  it("리플레이를 켜고 마스킹 셀렉터를 저장한다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers,
      payload: {
        name: project.name,
        allowedDomains: project.allowedDomains,
        replay: { enabled: true, maskSelectors: [".customer-name"] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().replay).toEqual({ enabled: true, maskSelectors: [".customer-name"] });
    expect((await store.getProject(project.projectId))?.replay.enabled).toBe(true);
  });

  it("셀렉터가 아닌 값을 거절한다", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers,
      payload: {
        name: project.name,
        allowedDomains: project.allowedDomains,
        replay: { enabled: true, maskSelectors: ["body{display:none}"] },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_project_settings" });
  });

  // 감사 로그가 "누가 언제 기록을 켰나" 를 남기지 못하면 개인정보 사고를
  // 추적할 방법이 없다. 리플레이는 이 저장소에서 가장 넓게 수집하는 기능이다.
  it("리플레이 변경을 감사 로그에 남긴다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();

    await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers,
      payload: {
        name: project.name,
        allowedDomains: project.allowedDomains,
        replay: { enabled: true, maskSelectors: [] },
      },
    });

    const logs = await store.listAuditLogs();
    const updated = logs.find((log) => log.action === "project.updated");
    expect((updated?.metadata.before as { replay?: unknown }).replay).toEqual({
      enabled: false,
      maskSelectors: [],
    });
    expect((updated?.metadata.after as { replay?: unknown }).replay).toEqual({
      enabled: true,
      maskSelectors: [],
    });
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

  it("adds representative screen context events to issue list responses", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-02T01:00:01.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          metadata: {},
          screenContext: {
            viewport: { width: 1440, height: 900 },
            target: {
              tagName: "button",
              role: "button",
              textMaskedOrLimited: "저장",
              rect: { x: 620, y: 420, width: 96, height: 40 },
            },
            layoutHints: [],
          },
        },
      ],
    });
    await store.upsertIssues(project.projectId, [{
      issueId: "issue_1",
      projectId: project.projectId,
      issueType: "dead_click_cluster",
      title: "저장 버튼 반응 없음",
      summary: "설정 화면에서 저장 버튼 클릭 후 후속 이벤트가 없습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 60,
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:00:00.000Z",
      trend: "flat",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new",
    }]);
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const issues = response.json();
    expect(issues[0].representativeEvent).toMatchObject({
      eventId: "evt_1",
      type: "click",
      screenContext: {
        target: {
          textMaskedOrLimited: "저장",
        },
      },
    });
  });

  it("adds a representative screen context event to the issue detail response", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-02T01:00:01.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          metadata: {},
          screenContext: {
            viewport: { width: 1440, height: 900 },
            target: {
              tagName: "button",
              role: "button",
              textMaskedOrLimited: "저장",
              rect: { x: 620, y: 420, width: 96, height: 40 },
            },
            layoutHints: [],
          },
        },
      ],
    });
    await store.upsertIssues(project.projectId, [{
      issueId: "issue_1",
      projectId: project.projectId,
      issueType: "dead_click_cluster",
      title: "저장 버튼 반응 없음",
      summary: "설정 화면에서 저장 버튼 클릭 후 후속 이벤트가 없습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 60,
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:00:00.000Z",
      trend: "flat",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new",
    }]);
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/issues/issue_1?projectId=${project.projectId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().representativeEvent).toMatchObject({
      eventId: "evt_1",
      type: "click",
      screenContext: {
        target: {
          textMaskedOrLimited: "저장",
        },
      },
    });
  });

  it("이슈 시간 창에서 멀리 떨어진 클릭은 대표 화면으로 쓰지 않는다", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-02T03:00:01.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_unrelated_click",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          metadata: {},
          screenContext: {
            titleMasked: "설정",
            viewport: { width: 1440, height: 900 },
            target: {
              tagName: "button",
              role: "button",
              textMaskedOrLimited: "저장",
              rect: { x: 620, y: 420, width: 96, height: 40 },
            },
            layoutHints: [],
          },
        },
      ],
    });
    await store.upsertIssues(project.projectId, [{
      issueId: "issue_error",
      projectId: project.projectId,
      issueType: "error_friction",
      title: "/settings 화면에서 오류 기반 막힘이 감지되었습니다",
      summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 60,
      firstSeenAt: "2026-09-02T03:00:00.000Z",
      lastSeenAt: "2026-09-02T03:00:00.000Z",
      trend: "flat",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new",
    }]);
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).not.toHaveProperty("representativeEvent");
  });

  it("이슈 성격에 맞는 타입의 이벤트를 대표 화면으로 고른다", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    const screenContext = {
      titleMasked: "설정",
      viewport: { width: 1440, height: 900 },
      target: {
        tagName: "button",
        role: "button",
        textMaskedOrLimited: "저장",
        rect: { x: 620, y: 420, width: 96, height: 40 },
      },
      layoutHints: [],
    };
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-02T01:00:03.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_page_view",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "page_view",
          urlPath: "/settings",
          metadata: {},
          screenContext,
        },
        {
          eventId: "evt_click",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:01.000Z",
          type: "click",
          urlPath: "/settings",
          metadata: {},
          screenContext,
        },
      ],
    });
    await store.upsertIssues(project.projectId, [{
      issueId: "issue_rage",
      projectId: project.projectId,
      issueType: "rage_click",
      title: "/settings 화면에서 반복 클릭이 감지되었습니다",
      summary: "3회 클릭이 3초 안에 같은 요소에서 발생했습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 70,
      firstSeenAt: "2026-09-02T01:00:01.000Z",
      lastSeenAt: "2026-09-02T01:00:01.000Z",
      trend: "flat",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new",
    }]);
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].representativeEvent).toMatchObject({ eventId: "evt_click", type: "click" });
  });

  it("omits representativeEvent when no matching evidence exists", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    await store.upsertIssues(project.projectId, [{
      issueId: "issue_no_evidence",
      projectId: project.projectId,
      issueType: "dead_click_cluster",
      title: "증거 없는 이슈",
      summary: "일치하는 세션 이벤트가 없습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 40,
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:00:00.000Z",
      trend: "flat",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_missing"],
      status: "new",
    }]);
    const app = createApp({ store, authConfig });

    const listResponse = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: `/admin/api/issues/issue_no_evidence?projectId=${project.projectId}`,
      headers: { cookie },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()[0]).not.toHaveProperty("representativeEvent");
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).not.toHaveProperty("representativeEvent");
  });

  it("요소 키가 있는 이슈는 다른 요소의 클릭을 대표로 쓰지 않는다", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-09-04T00:00:00.000Z",
    });

    const screenContext = {
      viewport: { width: 1440, height: 900 },
      target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
      layoutHints: [],
    };
    const click = (eventId: string, timestamp: string, hash: string, text: string) => ({
      eventId,
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp,
      type: "click" as const,
      urlPath: "/settings",
      elementSelectorHash: hash,
      elementTextMaskedOrLimited: text,
      metadata: {},
      screenContext,
    });

    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-04T00:00:10.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        // 이슈 구간 밖(lead-in 자리)의 같은 요소 클릭. lead-in 을 없앴으므로 안 뽑혀야 한다.
        click("evt_target_before", "2026-09-04T00:00:00.000Z", "1111111111111111", "권한 추가"),
        // 이슈 구간 안이면서 대상보다 이른 다른 요소. 후보 선택은 가장 이른 것을
        // 고르므로, 요소 필터가 없으면 이것이 뽑힌다. 지금 결함이 정확히 이것이다.
        click("evt_other", "2026-09-04T00:00:05.000Z", "2222222222222222", "저장"),
        click("evt_target_in", "2026-09-04T00:00:05.500Z", "1111111111111111", "권한 추가"),
      ],
    });

    // 두 방어가 각각 지탱한다. 요소 필터가 빠지면 evt_other 가, 창 좁히기가
    // 빠지면 evt_target_before 가 뽑혀 둘 다 이 단정에서 걸린다.

    const targetKey = elementKey(click("x", "2026-09-04T00:00:05.000Z", "1111111111111111", "권한 추가") as TraceEvent)!;

    await store.upsertIssues(project.projectId, [
      {
        issueId: `issue__settings|${targetKey}|rage_click`,
        projectId: project.projectId,
        issueType: "rage_click",
        title: "/settings 화면에서 반복 클릭이 감지되었습니다",
        summary: "3회 클릭이 3초 안에 같은 요소에서 발생했습니다.",
        affectedSessionsCount: 1,
        affectedUsersCount: 1,
        severityScore: 70,
        firstSeenAt: "2026-09-04T00:00:05.000Z",
        lastSeenAt: "2026-09-04T00:00:06.000Z",
        trend: "flat",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
        elementKey: targetKey,
      },
    ]);

    const app = createApp({ store, authConfig });
    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].representativeEvent).toMatchObject({ eventId: "evt_target_in" });
  });

  it("요소 키가 없는 이슈는 30초 앞 클릭을 계속 쓴다", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-09-04T00:00:00.000Z",
    });

    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-04T00:00:40.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_click_before_error",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-04T00:00:20.000Z",
          type: "click",
          urlPath: "/settings",
          elementSelectorHash: "3333333333333333",
          elementTextMaskedOrLimited: "오류 발생",
          metadata: {},
          screenContext: {
            viewport: { width: 1440, height: 900 },
            target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
            layoutHints: [],
          },
        },
      ],
    });

    // 오류 이벤트에는 화면 맥락이 없다. 이슈 시점은 클릭보다 20초 뒤라
    // lead-in 이 없으면 후보가 사라진다 — 그래서 이 부류에서는 유지한다.
    await store.upsertIssues(project.projectId, [
      {
        issueId: "issue__settings|page|error_friction",
        projectId: project.projectId,
        issueType: "error_friction",
        title: "/settings 화면에서 오류 기반 막힘이 감지되었습니다",
        summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
        affectedSessionsCount: 1,
        affectedUsersCount: 1,
        severityScore: 60,
        firstSeenAt: "2026-09-04T00:00:40.000Z",
        lastSeenAt: "2026-09-04T00:00:40.000Z",
        trend: "flat",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
      },
    ]);

    const app = createApp({ store, authConfig });
    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].representativeEvent).toMatchObject({ eventId: "evt_click_before_error" });
  });

  it("요소가 일치하는 클릭이 없으면 다른 화면으로 채우지 않는다", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-09-04T00:00:00.000Z",
    });

    // 이슈 구간 안에 클릭이 있지만 전부 다른 요소다. 예전에는 이 클릭이 뽑혀
    // 형제 버튼의 화면을 근거로 보여줬다. 이제는 비운다.
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-04T00:00:10.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_other_only",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-04T00:00:05.000Z",
          type: "click",
          urlPath: "/settings",
          elementSelectorHash: "9999999999999999",
          elementTextMaskedOrLimited: "저장",
          metadata: {},
          screenContext: {
            viewport: { width: 1440, height: 900 },
            target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
            layoutHints: [],
          },
        },
      ],
    });

    await store.upsertIssues(project.projectId, [
      {
        issueId: "issue__settings|1111111111111111|rage_click",
        projectId: project.projectId,
        issueType: "rage_click",
        title: "/settings 화면에서 반복 클릭이 감지되었습니다",
        summary: "3회 클릭이 3초 안에 같은 요소에서 발생했습니다.",
        affectedSessionsCount: 1,
        affectedUsersCount: 1,
        severityScore: 70,
        firstSeenAt: "2026-09-04T00:00:05.000Z",
        lastSeenAt: "2026-09-04T00:00:06.000Z",
        trend: "flat",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
        elementKey: "1111111111111111",
      },
    ]);

    const app = createApp({ store, authConfig });
    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).not.toHaveProperty("representativeEvent");
  });

  it("elementKey 를 실은 error_friction 이슈도 요소 필터 갈래를 타지 않는다", async () => {
    // detectLongPauses·detectErrorFriction 은 elementKey(event) 를 조건 없이
    // 부른다(detect.ts). js_error 이벤트에도 elementSelectorHash 가 실릴 수
    // 있으므로(어떤 HTTP 클라이언트든 보낼 수 있다 — SDK 가 안 그러는 것은 계약이
    // 아니라 우연이다) error_friction 이슈가 elementKey 를 가질 수 있다. 이때도
    // 요소 필터 갈래(창을 이슈 시점 하나로 좁히고 element_key 로 거르는 갈래)를
    // 타면 안 된다 — 타면 아래 클릭이 elementKey 까지 일치하는데도 30초 lead-in
    // 창 밖이라는 이유로 사라진다.
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-09-04T00:00:00.000Z",
    });

    const click = {
      eventId: "evt_click_before_error",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-04T00:00:20.000Z",
      type: "click" as const,
      urlPath: "/settings",
      elementSelectorHash: "3333333333333333",
      elementTextMaskedOrLimited: "오류 발생",
      metadata: {},
      screenContext: {
        viewport: { width: 1440, height: 900 },
        target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
        layoutHints: [],
      },
    };
    const clickElementKey = elementKey(click as TraceEvent)!;

    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-04T00:00:40.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [click],
    });

    // 이슈 시점은 클릭보다 20초 뒤다. 요소 필터 갈래를 탔다면 창이 이 한 시점으로
    // 좁혀져 20초 앞의 클릭은 elementKey 가 일치해도 후보에 들지 못한다.
    await store.upsertIssues(project.projectId, [
      {
        issueId: "issue__settings|3333333333333333|error_friction",
        projectId: project.projectId,
        issueType: "error_friction",
        title: "/settings 화면에서 오류 기반 막힘이 감지되었습니다",
        summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
        affectedSessionsCount: 1,
        affectedUsersCount: 1,
        severityScore: 60,
        firstSeenAt: "2026-09-04T00:00:40.000Z",
        lastSeenAt: "2026-09-04T00:00:40.000Z",
        trend: "flat",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
        elementKey: clickElementKey,
      },
    ]);

    const app = createApp({ store, authConfig });
    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].representativeEvent).toMatchObject({ eventId: "evt_click_before_error" });
  });
});
