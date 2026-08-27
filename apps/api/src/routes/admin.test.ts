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
