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

async function withRecording() {
  const fixture = await createAuthenticatedOwner();
  await fixture.store.saveSessionRecordingChunk({
    sessionId: "sess_abc",
    projectId: fixture.project.projectId,
    seq: 0,
    startedAt: "2026-09-15T00:00:00.000Z",
    receivedAt: "2026-09-15T00:00:10.000Z",
    eventCount: 3,
    bytes: new Uint8Array([31, 139, 8, 0, 1, 2, 3]),
  });
  return fixture;
}

describe("GET /admin/api/sessions/:sessionId/recording", () => {
  it("청크 매니페스트를 돌려준다", async () => {
    const { app, project, headers } = await withRecording();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      chunks: [
        {
          seq: 0,
          eventCount: 3,
          bytes: 7,
          startedAt: "2026-09-15T00:00:00.000Z",
          receivedAt: "2026-09-15T00:00:10.000Z",
        },
      ],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("기록이 없으면 404 가 아니라 빈 배열이다", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_none/recording?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ chunks: [] });
  });

  it("인증이 없으면 401", async () => {
    const { app, project } = await withRecording();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording?projectId=${project.projectId}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("멤버가 아니면 403 이고 감사 로그를 남긴다", async () => {
    const { app, store, project, headers } = await withRecording();
    const outsider = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_outsider",
      email: "outsider@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: outsider });
    void headers;

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording?projectId=${project.projectId}`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(403);
    // listAuditLogs() 는 인자를 받지 않는다.
    const logs = await store.listAuditLogs();
    expect(logs.some((log) => log.action === "project.access_denied")).toBe(true);
  });

  it("조회자도 볼 수 있다", async () => {
    const { app, store, project, headers } = await withRecording();
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer",
      email: "viewer@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: viewer.adminUserId,
      role: "viewer",
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: viewer });
    void headers;

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording?projectId=${project.projectId}`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(200);
  });
});
