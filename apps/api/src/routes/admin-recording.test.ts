import { gzipSync } from "node:zlib";
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
  allowedEmails: new Set(["admin@example.com", "viewer@example.com", "viewer-chunk@example.com", "viewer-list@example.com", "viewer-stats@example.com"]),
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

  it("프로젝트를 만들지 않은 관리자도 볼 수 있다", async () => {
    const { app, store, project, headers } = await withRecording();
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer",
      email: "viewer@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
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

describe("GET /admin/api/sessions/:sessionId/recording/chunks/:seq", () => {
  async function withGzipChunk() {
    const fixture = await createAuthenticatedOwner();
    const body = gzipSync(
      Buffer.from(
        JSON.stringify({
          projectId: fixture.project.projectId,
          seq: 0,
          startedAt: "2026-09-15T00:00:00.000Z",
          url: "https://demo.example.com/",
          sdkVersion: "0.1.0",
          events: [{ type: 2, data: {}, timestamp: 1 }],
        }),
        "utf8",
      ),
    );
    await fixture.store.saveSessionRecordingChunk({
      sessionId: "sess_abc",
      projectId: fixture.project.projectId,
      seq: 0,
      startedAt: "2026-09-15T00:00:00.000Z",
      receivedAt: "2026-09-15T00:00:10.000Z",
      eventCount: 1,
      bytes: new Uint8Array(body),
    });
    return { ...fixture, body };
  }

  it("저장된 gzip 바이트를 그대로 돌려준다", async () => {
    const { app, project, headers, body } = await withGzipChunk();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/0?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    // 바이트가 하나도 달라지면 안 된다. 서버가 풀었다 다시 감으면 여기서 깨진다.
    expect(Buffer.compare(response.rawPayload, body)).toBe(0);
  });

  it("없는 seq 는 404", async () => {
    const { app, project, headers } = await withGzipChunk();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/9?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("seq 가 숫자가 아니면 400", async () => {
    const { app, project, headers } = await withGzipChunk();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/abc?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(400);
  });

  it("인증이 없으면 401", async () => {
    const { app, project } = await withGzipChunk();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/0?projectId=${project.projectId}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("프로젝트를 만들지 않은 관리자도 받을 수 있다", async () => {
    const { app, store, project } = await withGzipChunk();
    // 주의: 브리프 원문은 이 sub-user 에 owner 와 같은 이메일(admin@example.com)을
    // 쓴다 — upsertAdminUserFromGoogle 이 admin_email_conflict 로 던진다. Task 2 와
    // 같은 이유로 고유 이메일을 쓴다(fixture 신원 문제일 뿐 검증 내용은 그대로다).
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer_chunk",
      email: "viewer-chunk@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: viewer });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/0?projectId=${project.projectId}`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("GET /admin/api/projects/:projectId/sessions", () => {
  it("모든 세션을 최근 순으로 돌려준다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    // 기록이 없는 세션도 목록에 들어간다 - 기록 유무와 상관없이 흐름을 보려는 것이 이
    // 화면의 목적이다.
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_abc",
      sentAt: "2026-09-15T00:01:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/settings",
      events: [{
        eventId: "evt_1",
        sessionId: "sess_abc",
        pageId: "page_1",
        timestamp: "2026-09-15T00:00:00.000Z",
        type: "click",
        urlPath: "/settings",
        metadata: {},
      }],
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/sessions`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sessions: [
        {
          sessionId: "sess_abc",
          startedAt: "2026-09-15T00:00:00.000Z",
          lastSeenAt: "2026-09-15T00:00:00.000Z",
          eventCount: 1,
          hasRecording: false,
        },
      ],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("세션이 없으면 빈 배열", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/sessions`,
      headers,
    });

    expect(response.json()).toEqual({ sessions: [] });
  });

  it("인증이 없으면 401", async () => {
    const { app, project } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/sessions`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("프로젝트를 만들지 않은 관리자도 세션 목록을 볼 수 있다", async () => {
    const { app, store, project } = await createAuthenticatedOwner();
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer_list",
      email: "viewer-list@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: viewer });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/sessions`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("GET /admin/api/projects/:projectId/page-stats", () => {
  it("페이지 통계를 돌려준다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-15T00:10:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-15T00:00:00.000Z",
          type: "page_view",
          urlPath: "/home",
          metadata: {},
        },
        {
          eventId: "evt_2",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-15T00:00:10.000Z",
          type: "page_leave",
          urlPath: "/home",
          metadata: {},
        },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/page-stats`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pages[0].urlPath).toBe("/home");
    expect(body.pages[0].views).toBe(1);
    expect(body.pages[0].averageDwellMs).toBe(10_000);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("인증이 없으면 401", async () => {
    const { app, project } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/page-stats`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("프로젝트를 만들지 않은 관리자도 볼 수 있다", async () => {
    const { app, store, project } = await createAuthenticatedOwner();
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer_stats",
      email: "viewer-stats@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: viewer });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/page-stats`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(200);
  });
});
