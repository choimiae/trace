import { describe, expect, it } from "vitest";
import { buildClearedAuthCookies, createAdminSessionForUser, requireAdminSession } from "./session.js";
import type { AdminAuthConfig } from "./config.js";
import { createTestStore } from "../store/test-store.js";

const config: AdminAuthConfig = {
  googleClientId: "client",
  googleClientSecret: "secret",
  googleRedirectUri: "http://localhost:4000/auth/google/callback",
  adminAppOrigin: "http://localhost:5173",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  cookieSecure: true,
  allowedEmails: new Set(["admin@example.com"]),
  googleOAuthEnabled: true,
  localAdminLoginEnabled: false,
  sessionTtlSeconds: 60,
  loginRateLimitWindowSeconds: 300,
  loginRateLimitMax: 20,
  oauthCookieName: "__trace_oauth",
  sessionCookieName: "__trace_admin_session",
  csrfCookieName: "__trace_csrf",
};

describe("admin sessions", () => {
  it("creates HttpOnly session and readable CSRF cookies", async () => {
    const store = createTestStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });

    const result = await createAdminSessionForUser({ store, config, user, now: new Date("2026-08-25T00:00:00.000Z") });

    expect(result.cookie).toContain("__trace_admin_session=");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(result.cookie).toContain("Secure");
    expect(result.cookie).toContain("Path=/");
    expect(result.csrfCookie).toContain("__trace_csrf=");
    expect(result.csrfCookie).not.toContain("HttpOnly");
  });

  it("rejects expired and revoked sessions", async () => {
    const store = createTestStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });
    const created = await createAdminSessionForUser({ store, config, user, now: new Date("2026-08-25T00:00:00.000Z") });
    const rawCookie = created.cookie.split(";")[0]!;

    expect(await requireAdminSession({ store, config, cookieHeader: rawCookie, now: new Date("2026-08-25T00:02:00.000Z") }))
      .toEqual({ error: "admin_auth_required" });
  });

  it("rejects revoked sessions", async () => {
    const store = createTestStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });
    const created = await createAdminSessionForUser({ store, config, user, now: new Date("2026-08-25T00:00:00.000Z") });

    await store.revokeAdminSession(created.session.sessionIdHash, "2026-08-25T00:01:00.000Z");

    expect(await requireAdminSession({
      store,
      config,
      cookieHeader: created.cookie.split(";")[0]!,
      now: new Date("2026-08-25T00:01:00.000Z"),
    })).toEqual({ error: "admin_auth_required" });
  });

  it("허용 목록에서 빠진 관리자의 유효한 세션을 거부한다", async () => {
    const store = createTestStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "Admin@Example.com",
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });
    const created = await createAdminSessionForUser({ store, config, user, now: new Date("2026-08-25T00:00:00.000Z") });
    const cookieHeader = created.cookie.split(";")[0]!;
    const now = new Date("2026-08-25T00:00:30.000Z");

    expect("error" in await requireAdminSession({ store, config, cookieHeader, now })).toBe(false);

    const removed = { ...config, allowedEmails: new Set(["other@example.com"]) };
    expect(await requireAdminSession({ store, config: removed, cookieHeader, now })).toEqual({ error: "admin_auth_required" });
  });

  it("clears session and CSRF cookies", () => {
    expect(buildClearedAuthCookies(config)).toEqual([
      "__trace_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
      "__trace_csrf=; Max-Age=0; Path=/; Secure; SameSite=Lax",
    ]);
  });
});
