import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadLocalEnvFiles } from "./local-env.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("loadLocalEnvFiles", () => {
  it("loads root and api .env files without overriding existing environment values", () => {
    const cwd = mkdtempSync(join(tmpdir(), "trace-env-"));
    tempDirs.push(cwd);
    const env = {
      GOOGLE_CLIENT_ID: "from-shell",
    };

    writeFileSync(join(cwd, ".env"), [
      "NODE_ENV=development",
      "GOOGLE_CLIENT_ID=from-root",
      "GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback",
      "ADMIN_APP_ORIGIN='http://localhost:5173'",
      "# ignored comment",
    ].join("\n"));
    writeFileSync(join(cwd, "apps-api.env"), [
      "GOOGLE_CLIENT_SECRET=from-api",
      "SESSION_SECRET=\"12345678901234567890123456789012\"",
      "ADMIN_ALLOWED_EMAILS=admin@example.com",
      "GOOGLE_REDIRECT_URI=http://wrong.example/callback",
    ].join("\n"));

    loadLocalEnvFiles({
      cwd,
      env,
      files: [".env", "apps-api.env"],
    });

    expect(env).toEqual({
      NODE_ENV: "development",
      GOOGLE_CLIENT_ID: "from-shell",
      GOOGLE_CLIENT_SECRET: "from-api",
      GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
      SESSION_SECRET: "12345678901234567890123456789012",
      ADMIN_APP_ORIGIN: "http://localhost:5173",
      ADMIN_ALLOWED_EMAILS: "admin@example.com",
    });
  });

  it("ignores blank assignments so templates do not block real values from later files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "trace-env-"));
    tempDirs.push(cwd);
    const env = {};

    writeFileSync(join(cwd, "api.env"), "GOOGLE_CLIENT_ID=\n");
    writeFileSync(join(cwd, "root.env"), "GOOGLE_CLIENT_ID=from-root\n");

    loadLocalEnvFiles({
      cwd,
      env,
      files: ["api.env", "root.env"],
    });

    expect(env).toEqual({ GOOGLE_CLIENT_ID: "from-root" });
  });

  it("uses INIT_CWD as the project root when npm runs the api workspace from apps/api", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "trace-env-"));
    tempDirs.push(projectRoot);
    const apiCwd = join(projectRoot, "apps", "api");
    const env = {
      INIT_CWD: projectRoot,
    };

    writeFileSync(join(projectRoot, ".env"), "NODE_ENV=development\n");
    writeFileSync(join(projectRoot, "apps-api.env"), "GOOGLE_CLIENT_SECRET=from-api\n");

    loadLocalEnvFiles({
      cwd: apiCwd,
      env,
      files: ["apps-api.env", ".env"],
    });

    expect(env).toEqual({
      INIT_CWD: projectRoot,
      NODE_ENV: "development",
      GOOGLE_CLIENT_SECRET: "from-api",
    });
  });
});
