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
  const { store, cookie, csrfToken } = await signedInStore();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });
  const app = createApp({ store, authConfig });
  const headers = { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken };
  return { app, store, project, headers };
}

// 허용 이메일 목록에 든 관리자를 여럿 만들고, 이메일로 로그인 쿠키를 발급한다.
async function setupTwoAdmins(emails: string[]) {
  const config: AdminAuthConfig = { ...authConfig, allowedEmails: new Set(emails) };
  const store = new MemoryStore();
  const app = createApp({ store, authConfig: config });
  const cookieFor = async (email: string) => {
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: `google_sub_${email}`,
      email,
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config, user });
    const cookie = `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`;
    return {
      headers: { cookie },
      headersWithCsrf: { cookie, origin: config.adminAppOrigin, "x-trace-csrf": session.csrfToken },
    };
  };
  return { app, store, cookieFor };
}

describe("admin bff routes", () => {
  it("프로젝트를 만든다", async () => {
    const { store, cookie, csrfToken } = await signedInStore();
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
    expect(await store.getProject(body.projectId)).toMatchObject({ name: "Demo SaaS" });
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

  // 생성 시점의 replay 는 무시된다 — 거절되지도, 반영되지도 않는다. 새
  // 프로젝트는 항상 기본 꺼짐으로 시작한다(Task 2 store 계약). 켜는 것은
  // 프로젝트 설정(PATCH) 경로의 일이다.
  it("생성 요청의 replay 를 무시하고 기본값으로 만든다", async () => {
    const { store, cookie, csrfToken } = await signedInStore();
    const app = createApp({ store, authConfig });

    const response = await app.inject({
      method: "POST",
      url: "/admin/api/projects",
      headers: { cookie, origin: authConfig.adminAppOrigin, "x-trace-csrf": csrfToken },
      payload: {
        name: "Demo SaaS",
        allowedDomains: ["https://demo.example.com"],
        replay: { enabled: true, maskSelectors: [".customer-name"] },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().replay).toEqual({ enabled: false, maskSelectors: [] });
    const project = await store.getProject(response.json().projectId);
    expect(project?.replay).toEqual({ enabled: false, maskSelectors: [] });
  });


  it("프로젝트 설정을 역할 없이 돌려준다", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projectId: project.projectId,
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
      replay: { enabled: false, maskSelectors: [] },
    });
  });

  it("다른 관리자가 만든 프로젝트도 읽고 고칠 수 있다", async () => {
    const { app, store, cookieFor } = await setupTwoAdmins(["owner@example.com", "other@example.com"]);
    const created = await store.createProject({ name: "업무시스템", allowedDomains: ["https://app.example.com"] });
    const other = await cookieFor("other@example.com");

    const read = await app.inject({ method: "GET", url: `/admin/api/projects/${created.projectId}`, headers: other.headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).not.toHaveProperty("role");

    const patched = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${created.projectId}`,
      headers: other.headersWithCsrf,
      payload: { name: "업무시스템2", allowedDomains: ["https://app.example.com"] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).not.toHaveProperty("role");
    expect(await store.getProject(created.projectId)).toMatchObject({ name: "업무시스템2" });
    await app.close();
  });

  it("없는 프로젝트는 404 다", async () => {
    const { app, cookieFor } = await setupTwoAdmins(["owner@example.com"]);
    const owner = await cookieFor("owner@example.com");

    const response = await app.inject({ method: "GET", url: "/admin/api/projects/proj_missing", headers: owner.headers });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("프로젝트 설정을 고친다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers,
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
    });
    expect(await store.getProject(project.projectId)).toMatchObject({
      name: "New",
      allowedDomains: ["https://new.example.com"],
    });
  });

  it("rejects invalid project settings updates", async () => {
    const { store, cookie, csrfToken } = await signedInStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
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


  it("rejects Admin BFF requests without a session cookie", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig });
    const response = await app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/sessions" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "admin_auth_required" });
  });

  it("로그인한 관리자는 만든 사람이 아니어도 세션·통계를 본다", async () => {
    const { store, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Shared", allowedDomains: ["https://shared.example.com"] });
    const app = createApp({ store, authConfig });

    const responses = await Promise.all([
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/sessions`, headers: { cookie } }),
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/page-stats`, headers: { cookie } }),
      app.inject({ method: "GET", url: `/admin/api/sessions/sess_none/timeline?projectId=${project.projectId}`, headers: { cookie } }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
  });

  it("없는 프로젝트의 세션·통계·타임라인은 404 다", async () => {
    const { store, cookie } = await signedInStore();
    const app = createApp({ store, authConfig });

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/sessions", headers: { cookie } }),
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/page-stats", headers: { cookie } }),
      app.inject({ method: "GET", url: "/admin/api/sessions/sess_1/timeline?projectId=proj_missing", headers: { cookie } }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404]);
  });

  it("does not leak a session timeline across project scope", async () => {
    const { store, cookie } = await signedInStore();
    const projectA = await store.createProject({ name: "A", allowedDomains: ["https://a.example.com"] });
    const projectB = await store.createProject({ name: "B", allowedDomains: ["https://b.example.com"] });
    await store.saveBatch({
      projectId: projectA.projectId,
      events: [{
        eventId: "evt_a1",
        sessionId: "sess_a",
        pageId: "page_a",
        timestamp: "2026-08-25T00:00:00.000Z",
        type: "page_view",
        urlPath: "/a",
      }],
    } as Parameters<typeof store.saveBatch>[0]);
    const app = createApp({ store, authConfig });

    const own = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_a/timeline?projectId=${projectA.projectId}`,
      headers: { cookie },
    });
    const crossed = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_a/timeline?projectId=${projectB.projectId}`,
      headers: { cookie },
    });

    expect(own.statusCode).toBe(200);
    expect(own.json()).toHaveLength(1);
    expect(crossed.statusCode).toBe(200);
    expect(crossed.json()).toEqual([]);
  });
});
