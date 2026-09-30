import { describe, expect, it } from "vitest";
import { prepareServerStartup } from "./startup.js";

const completeProductionEnv = {
  NODE_ENV: "production",
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client_secret",
  GOOGLE_REDIRECT_URI: "https://api.trace.example/auth/google/callback",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  ADMIN_APP_ORIGIN: "https://admin.trace.example",
  ADMIN_ALLOWED_EMAILS: "admin@example.com",
};

describe("server startup", () => {
  it("requires Admin OAuth configuration in production", () => {
    expect(() => prepareServerStartup({ env: { NODE_ENV: "production" } }))
      .toThrow("ADMIN_OAUTH_CONFIG_REQUIRED");
  });

  it("rejects partial Admin OAuth configuration in production", () => {
    expect(() => prepareServerStartup({
      env: { ...completeProductionEnv, GOOGLE_REDIRECT_URI: "" },
    })).toThrow("ADMIN_OAUTH_CONFIG_REQUIRED");
  });

  it("rejects local-only Admin auth configuration in production", () => {
    expect(() => prepareServerStartup({
      env: {
        NODE_ENV: "production",
        LOCAL_ADMIN_LOGIN: "true",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        ADMIN_APP_ORIGIN: "https://admin.trace.example",
        ADMIN_ALLOWED_EMAILS: "admin@example.com",
      },
    })).toThrow("ADMIN_OAUTH_CONFIG_REQUIRED");
  });

  it("returns event retention config from startup env", () => {
    const startup = prepareServerStartup({
      env: { ...completeProductionEnv, EVENT_RETENTION_DAYS: "30" },
    });

    expect(startup.eventRetentionConfig).toEqual({ eventRetentionDays: 30 });
  });
});
