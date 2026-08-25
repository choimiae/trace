import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createApp } from "../app.js";
import { readOAuthStateCookie } from "../auth/google.js";
import { MemoryStore } from "../store/memory-store.js";
import type { AdminAuthConfig } from "../auth/config.js";
import type { GoogleOAuthClient } from "../auth/google.js";

const config: AdminAuthConfig = {
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

function fakeGoogleClient(): GoogleOAuthClient {
  return {
    getAuthorizationUrl: ({ state, nonce, codeChallenge }) =>
      new URL(`https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}&code_challenge=${codeChallenge}`),
    exchangeCode: async () => ({ idToken: "fake.id.token" }),
    verifyIdToken: async () => ({
      sub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      name: "Admin",
      pictureUrl: "https://example.com/avatar.png",
    }),
  };
}

describe("auth routes", () => {
  it("registers auth routes with the default Google client when auth config exists", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config });

    const response = await app.inject({ method: "GET", url: "/auth/google/start" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("https://accounts.google.com");
  });

  it("redirects Google login start and sets an OAuth state cookie", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });

    const response = await app.inject({ method: "GET", url: "/auth/google/start", headers: { origin: config.adminAppOrigin } });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("https://accounts.google.com");
    expect(String(response.headers["set-cookie"])).toContain("__trace_oauth=");
    const oauthCookie = Array.isArray(response.headers["set-cookie"])
      ? response.headers["set-cookie"][0] ?? ""
      : String(response.headers["set-cookie"]);
    const oauthState = readOAuthStateCookie({ config, cookieHeader: oauthCookie.split(";")[0] });
    const codeChallenge = new URL(String(response.headers.location)).searchParams.get("code_challenge");
    expect(codeChallenge).toBe(createHash("sha256").update(oauthState!.codeVerifier).digest("base64url"));
  });

  it("exchanges callback code, creates session cookies, and redirects to the Admin app", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });
    const start = await app.inject({ method: "GET", url: "/auth/google/start", headers: { origin: config.adminAppOrigin } });
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    const oauthCookie = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"][0] ?? ""
      : String(start.headers["set-cookie"]);

    const callback = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=code_1&state=${state}`,
      headers: { cookie: oauthCookie.split(";")[0] },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(config.adminAppOrigin);
    expect(String(callback.headers["set-cookie"])).toContain("__trace_admin_session=");
  });

  it("returns auth/me for a valid session and 401 without a session", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });
    const start = await app.inject({ method: "GET", url: "/auth/google/start" });
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    const oauthCookie = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"][0] ?? ""
      : String(start.headers["set-cookie"]);
    const callback = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=code_1&state=${state}`,
      headers: { cookie: oauthCookie.split(";")[0] },
    });
    const sessionCookie = String(callback.headers["set-cookie"]).split(",").find((value) => value.includes("__trace_admin_session="))!;

    expect((await app.inject({ method: "GET", url: "/auth/me" })).statusCode).toBe(401);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: sessionCookie.split(";")[0] } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("admin@example.com");
    expect(me.json().csrfToken).toBeTruthy();
  });

  it("logs out with CSRF and clears auth cookies", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });
    const start = await app.inject({ method: "GET", url: "/auth/google/start" });
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    const oauthCookie = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"][0] ?? ""
      : String(start.headers["set-cookie"]);
    const callback = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=code_1&state=${state}`,
      headers: { cookie: oauthCookie.split(";")[0] },
    });
    const setCookies = Array.isArray(callback.headers["set-cookie"]) ? callback.headers["set-cookie"] : [String(callback.headers["set-cookie"])];
    const sessionCookie = setCookies.find((value) => value.includes("__trace_admin_session="))!.split(";")[0]!;
    const csrfCookie = setCookies.find((value) => value.includes("__trace_csrf="))!.split(";")[0]!;
    const csrfToken = csrfCookie.split("=")[1]!;

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: `${sessionCookie}; ${csrfCookie}`, origin: config.adminAppOrigin, "x-trace-csrf": csrfToken },
    });

    expect(logout.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: sessionCookie } })).statusCode).toBe(401);
  });

  it("rejects callback state mismatch", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });
    const response = await app.inject({ method: "GET", url: "/auth/google/callback?code=code_1&state=wrong" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "oauth_state_invalid" });
  });

  it("rejects a replayed OAuth callback", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });
    const start = await app.inject({ method: "GET", url: "/auth/google/start" });
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    const oauthCookie = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"][0] ?? ""
      : String(start.headers["set-cookie"]);
    const request = {
      method: "GET" as const,
      url: `/auth/google/callback?code=code_1&state=${state}`,
      headers: { cookie: oauthCookie.split(";")[0] },
    };

    expect((await app.inject(request)).statusCode).toBe(302);
    expect((await app.inject(request)).json()).toEqual({ error: "oauth_state_invalid" });
  });

  it("rate limits Google login start requests", async () => {
    const app = createApp({
      store: new MemoryStore(),
      authConfig: { ...config, loginRateLimitMax: 1 },
      googleOAuthClient: fakeGoogleClient(),
    });

    expect((await app.inject({ method: "GET", url: "/auth/google/start" })).statusCode).toBe(302);
    const limited = await app.inject({ method: "GET", url: "/auth/google/start" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "login_rate_limited" });
  });

  it("rate limits Google callback requests", async () => {
    const app = createApp({
      store: new MemoryStore(),
      authConfig: { ...config, loginRateLimitMax: 1 },
      googleOAuthClient: fakeGoogleClient(),
    });

    expect((await app.inject({ method: "GET", url: "/auth/google/callback?code=code_1&state=wrong" })).statusCode).toBe(401);
    const limited = await app.inject({ method: "GET", url: "/auth/google/callback?code=code_1&state=wrong" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "login_rate_limited" });
  });
});
