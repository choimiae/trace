import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createAdminSessionForUser } from "../auth/session.js";
import type { AdminAuthConfig } from "../auth/config.js";
import { createTestStore } from "../store/test-store.js";

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
  const store = createTestStore();
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
  const store = createTestStore();
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
    const app = createApp({ store: createTestStore(), authConfig });
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
      anonymousUserId: "anon_a",
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

describe("admin api 접근 통제", () => {
  const routes: Array<{ method: "GET" | "POST" | "PATCH"; url: string; payload?: unknown }> = [
    { method: "POST", url: "/admin/api/projects", payload: { name: "x", allowedDomains: ["https://a.example.com"] } },
    { method: "GET", url: "/admin/api/projects/proj_x" },
    { method: "PATCH", url: "/admin/api/projects/proj_x", payload: { name: "y" } },
    { method: "GET", url: "/admin/api/projects/proj_x/sessions" },
    { method: "GET", url: "/admin/api/projects/proj_x/page-stats" },
    { method: "GET", url: "/admin/api/sessions/sess_x/timeline?projectId=proj_x" },
    { method: "GET", url: "/admin/api/sessions/sess_x/recording?projectId=proj_x" },
    { method: "GET", url: "/admin/api/sessions/sess_x/recording/chunks/0?projectId=proj_x" },
  ];

  it.each(routes)("세션 쿠키가 없으면 $method $url 은 401 이다", async ({ method, url, payload }) => {
    const app = createApp({ store: createTestStore(), authConfig });
    const response = await app.inject({ method, url, ...(payload ? { payload: payload as object } : {}) });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "admin_auth_required" });
  });

  const writes = routes.filter((route) => route.method !== "GET");

  it.each(writes)("CSRF 헤더가 없거나 틀리면 $method $url 은 403 이다", async ({ method, url, payload }) => {
    const { app, project, headers } = await createAuthenticatedOwner();
    const target = url.replace("proj_x", project.projectId);
    const base = { method, url: target, payload: payload as object };

    const missing = await app.inject({ ...base, headers: { cookie: headers.cookie, origin: headers.origin } });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toEqual({ error: "csrf_token_invalid" });

    const wrong = await app.inject({ ...base, headers: { ...headers, "x-trace-csrf": "wrong" } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: "csrf_token_invalid" });
  });

  it.each(writes)("허용되지 않은 origin 이면 $method $url 은 403 이다", async ({ method, url, payload }) => {
    const { app, project, headers } = await createAuthenticatedOwner();
    const response = await app.inject({
      method,
      url: url.replace("proj_x", project.projectId),
      payload: payload as object,
      headers: { ...headers, origin: "https://evil.example.com" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "csrf_origin_invalid" });
  });

  it.each(["timeline", "recording", "recording/chunks/0"])("projectId 쿼리가 없으면 %s 는 400 이다", async (suffix) => {
    const { app, headers } = await createAuthenticatedOwner();
    const response = await app.inject({ method: "GET", url: `/admin/api/sessions/sess_x/${suffix}`, headers });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_project_query" });
  });
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function seedPageView(
  store: ReturnType<typeof createTestStore>,
  projectId: string,
  sessionId: string,
  timestamp: string,
  urlPath = "/a",
) {
  await store.saveBatch({
    projectId,
    anonymousUserId: "anon_1",
    sessionId,
    sentAt: timestamp,
    sdkVersion: "0.1.0",
    url: "https://demo.example.com/",
    events: [{ eventId: `evt_${sessionId}_${urlPath}`, sessionId, pageId: "page_1", timestamp, type: "page_view", urlPath, metadata: {} }],
  });
}

describe("기능 사용 API", () => {
  it("기본 7일, days 로 기간을 바꾼다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_recent", daysAgo(2));
    await seedPageView(store, project.projectId, "sess_old", daysAgo(10));
    const get = (query: string) =>
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/features${query}`, headers });

    const [byDefault, week, month, day] = await Promise.all([get(""), get("?days=7"), get("?days=30"), get("?days=1")]);

    expect(byDefault.statusCode).toBe(200);
    expect(byDefault.headers["cache-control"]).toBe("no-store");
    expect(byDefault.json().summary.sessions).toBe(1);
    expect(week.json().summary.sessions).toBe(1);
    expect(month.json().summary.sessions).toBe(2);
    expect(day.json().summary.sessions).toBe(0);
    expect(month.json().screens[0]).toMatchObject({ urlPath: "/a", name: "/a", views: 2 });
  });

  it.each(["?days=2", "?days=abc", "?days=7&days=30"])("잘못된 기간 %s 는 400 이다", async (query) => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/features${query}`, headers });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_period" });
  });

  it("로그인하지 않으면 401, 없는 프로젝트는 404 다", async () => {
    const { app, headers } = await createAuthenticatedOwner();

    const [anonymous, missing] = await Promise.all([
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/features" }),
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/features", headers }),
    ]);

    expect(anonymous.statusCode).toBe(401);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "project_not_found" });
  });
});

describe("이동 흐름 API", () => {
  it("기간과 시작 화면으로 경로 순위를 돌려준다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_1", daysAgo(1), "/a");
    await seedPageView(store, project.projectId, "sess_1", daysAgo(0.99), "/b");
    await seedPageView(store, project.projectId, "sess_2", daysAgo(2), "/b");
    await seedPageView(store, project.projectId, "sess_old", daysAgo(10), "/a");
    const get = (query: string) =>
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/paths${query}`, headers });

    const [all, fromB, emptyStart] = await Promise.all([get(""), get("?start=%2Fb"), get("?start=")]);

    expect(all.statusCode).toBe(200);
    expect(all.headers["cache-control"]).toBe("no-store");
    expect(all.json()).toEqual({
      totalSessions: 2,
      paths: [
        { steps: ["/a", "/b"], exited: true, sessions: 1, ratio: 0.5 },
        { steps: ["/b"], exited: true, sessions: 1, ratio: 0.5 },
      ],
      names: { "/a": "/a", "/b": "/b" },
    });
    expect(fromB.json().paths).toEqual([{ steps: ["/b"], exited: true, sessions: 2, ratio: 1 }]);
    expect(emptyStart.json()).toEqual(all.json());
  });

  it("잘못된 기간은 invalid_period, start 가 둘이면 invalid_path_start 다", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();
    const get = (query: string) =>
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/paths${query}`, headers });

    const [badDays, twoStarts] = await Promise.all([get("?days=2"), get("?start=%2Fa&start=%2Fb")]);

    expect(badDays.statusCode).toBe(400);
    expect(badDays.json()).toEqual({ error: "invalid_period" });
    expect(twoStarts.statusCode).toBe(400);
    expect(twoStarts.json()).toEqual({ error: "invalid_path_start" });
  });

  it("로그인하지 않으면 401, 없는 프로젝트는 404 다", async () => {
    const { app, headers } = await createAuthenticatedOwner();

    const [anonymous, missing] = await Promise.all([
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/paths" }),
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/paths", headers }),
    ]);

    expect(anonymous.statusCode).toBe(401);
    expect(missing.statusCode).toBe(404);
  });
});

describe("세션 목록 API", () => {
  it("기본 7일 안에 시작한 세션을 total·names 와 함께 돌려주고 옛 필드를 지킨다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_recent", daysAgo(2));
    await seedPageView(store, project.projectId, "sess_old", daysAgo(10));

    const response = await app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/sessions`, headers });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.names).toEqual({ "/a": "/a" });
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      sessionId: "sess_recent",
      eventCount: 1,
      hasRecording: false,
      screenCount: 1,
      screens: ["/a"],
    });
    expect(body.sessions[0]).toHaveProperty("startedAt");
    expect(body.sessions[0]).toHaveProperty("lastSeenAt");
  });

  it("인코딩한 경로 필터로 세션을 거른다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_1", daysAgo(1), "/quote/:id");
    await seedPageView(store, project.projectId, "sess_1", daysAgo(0.99), "/견적");
    await seedPageView(store, project.projectId, "sess_2", daysAgo(1), "/quote/:id");
    const step = (value: string) => `step=${encodeURIComponent(value)}`;

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/sessions?${step("/quote/:id")}&${step("/견적")}&exited=true`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual(["sess_1"]);
  });

  it("화면 필터로 세션을 거른다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_1", daysAgo(1), "/a");
    await seedPageView(store, project.projectId, "sess_2", daysAgo(1), "/b");

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/sessions?screen=%2Fb`,
      headers,
    });

    expect(response.json().total).toBe(1);
    expect(response.json().sessions[0].sessionId).toBe("sess_2");
  });

  it.each([
    ["?screen=%2Fa&step=%2Fa", "invalid_session_filter"],
    ["?featurePath=%2Fa", "invalid_session_filter"],
    ["?start=%2Fa", "invalid_session_filter"],
    ["?step=%2Fa&exited=yes", "invalid_session_filter"],
    ["?days=2", "invalid_period"],
  ])("%s 는 400 %s 다", async (query, error) => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/sessions${query}`, headers });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
  });
});
