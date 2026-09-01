import { describe, expect, it } from "vitest";
import { assertDeployableAdminAuthConfig, loadAdminAuthConfig } from "./config.js";

const validConfigEnv = {
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client_secret",
  GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  ADMIN_APP_ORIGIN: "http://localhost:5173",
  ADMIN_ALLOWED_EMAILS: "admin@example.com",
};

describe("admin auth config", () => {
  it("returns undefined when Google OAuth env is absent", () => {
    expect(loadAdminAuthConfig({})).toBeUndefined();
  });

  it("parses local admin login config without Google OAuth env in development", () => {
    const config = loadAdminAuthConfig({
      NODE_ENV: "development",
      LOCAL_ADMIN_LOGIN: "true",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      ADMIN_APP_ORIGIN: "http://localhost:5173",
      ADMIN_ALLOWED_EMAILS: "admin@example.com, owner@example.com",
      COOKIE_SECURE: "false",
    });

    expect(config?.localAdminLoginEnabled).toBe(true);
    expect(config?.googleOAuthEnabled).toBe(false);
    expect(config?.allowedEmails.has("admin@example.com")).toBe(true);
    expect(config?.cookieSecure).toBe(false);
  });

  it("requires complete Admin OAuth configuration in production", () => {
    expect(() => assertDeployableAdminAuthConfig(undefined, { NODE_ENV: "production" })).toThrow(
      "ADMIN_OAUTH_CONFIG_REQUIRED",
    );
  });

  it("rejects partial Admin OAuth configuration in production", () => {
    const partialConfig = loadAdminAuthConfig({ ...validConfigEnv, GOOGLE_CLIENT_SECRET: "" });

    expect(partialConfig).toBeUndefined();
    expect(() => assertDeployableAdminAuthConfig(partialConfig, { NODE_ENV: "production" })).toThrow(
      "ADMIN_OAUTH_CONFIG_REQUIRED",
    );
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

  it("rejects local admin login outside development and test", () => {
    const config = loadAdminAuthConfig({
      NODE_ENV: "production",
      LOCAL_ADMIN_LOGIN: "true",
      GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "client_secret",
      GOOGLE_REDIRECT_URI: "https://api.trace.example/auth/google/callback",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      ADMIN_APP_ORIGIN: "https://admin.trace.example",
      ADMIN_ALLOWED_EMAILS: "admin@example.com",
    });

    expect(() => assertDeployableAdminAuthConfig(config!, { NODE_ENV: "production" })).toThrow("LOCAL_ADMIN_LOGIN");
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

  it.each([
    ["SESSION_TTL_SECONDS", "0"],
    ["SESSION_TTL_SECONDS", "-1"],
    ["SESSION_TTL_SECONDS", "1.5"],
    ["SESSION_TTL_SECONDS", "9007199254740992"],
    ["LOGIN_RATE_LIMIT_WINDOW_SECONDS", "0"],
    ["LOGIN_RATE_LIMIT_WINDOW_SECONDS", "-1"],
    ["LOGIN_RATE_LIMIT_WINDOW_SECONDS", "1.5"],
    ["LOGIN_RATE_LIMIT_WINDOW_SECONDS", "9007199254740992"],
    ["LOGIN_RATE_LIMIT_MAX", "0"],
    ["LOGIN_RATE_LIMIT_MAX", "-1"],
    ["LOGIN_RATE_LIMIT_MAX", "1.5"],
    ["LOGIN_RATE_LIMIT_MAX", "9007199254740992"],
  ])("rejects invalid %s value %s", (name, value) => {
    expect(() => loadAdminAuthConfig({ ...validConfigEnv, [name]: value })).toThrow(name);
  });
});
