import { describe, expect, it } from "vitest";
import { assertDeployableAdminAuthConfig, loadAdminAuthConfig } from "./config.js";

describe("admin auth config", () => {
  it("returns undefined when Google OAuth env is absent", () => {
    expect(loadAdminAuthConfig({})).toBeUndefined();
  });

  it("parses required OAuth, session, origin, allowlist, and local cookie settings", () => {
    const config = loadAdminAuthConfig({
      GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "client_secret",
      GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      ADMIN_APP_ORIGIN: "http://localhost:5173",
      ADMIN_ALLOWED_EMAILS: "admin@example.com, owner@example.com ",
      COOKIE_SECURE: "false",
      SESSION_TTL_SECONDS: "60",
      LOGIN_RATE_LIMIT_WINDOW_SECONDS: "30",
      LOGIN_RATE_LIMIT_MAX: "5",
    });

    expect(config?.adminAppOrigin).toBe("http://localhost:5173");
    expect(config?.allowedEmails.has("admin@example.com")).toBe(true);
    expect(config?.allowedEmails.has("owner@example.com")).toBe(true);
    expect(config?.cookieSecure).toBe(false);
    expect(config?.sessionTtlSeconds).toBe(60);
    expect(config?.oauthCookieName).toBe("__trace_oauth");
  });

  it("requires secure cookies for production", () => {
    const config = loadAdminAuthConfig({
      GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "client_secret",
      GOOGLE_REDIRECT_URI: "https://api.trace.example/auth/google/callback",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      ADMIN_APP_ORIGIN: "https://admin.trace.example",
      ADMIN_ALLOWED_EMAILS: "admin@example.com",
      COOKIE_SECURE: "false",
    });

    expect(() => assertDeployableAdminAuthConfig(config!, { NODE_ENV: "production" })).toThrow("COOKIE_SECURE");
  });

  it("requires secure cookies for staging and preview deployments", () => {
    const config = loadAdminAuthConfig({
      GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "client_secret",
      GOOGLE_REDIRECT_URI: "https://api.trace.example/auth/google/callback",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      ADMIN_APP_ORIGIN: "https://admin.trace.example",
      ADMIN_ALLOWED_EMAILS: "admin@example.com",
      COOKIE_SECURE: "false",
    });

    expect(() => assertDeployableAdminAuthConfig(config!, { NODE_ENV: "staging" })).toThrow("COOKIE_SECURE");
    expect(() => assertDeployableAdminAuthConfig(config!, { NODE_ENV: "preview" })).toThrow("COOKIE_SECURE");
  });

  it("returns undefined when the admin email allowlist is empty", () => {
    expect(
      loadAdminAuthConfig({
        GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "client_secret",
        GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        ADMIN_APP_ORIGIN: "http://localhost:5173",
        ADMIN_ALLOWED_EMAILS: ",,,",
      }),
    ).toBeUndefined();
  });
});
