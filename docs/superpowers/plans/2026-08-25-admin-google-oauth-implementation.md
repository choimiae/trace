# Admin Google OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trace Admin을 Google OAuth Authorization Code Flow와 `HttpOnly` Trace 세션 쿠키 기반의 배포 가능한 인증 경계로 전환한다.

**Architecture:** 기존 `apps/api` Fastify app 안에 Admin BFF를 둔다. 브라우저는 Google token, Trace internal token, shared admin token을 받지 않고 `/auth/*`와 `/admin/api/*`만 `credentials: "include"`로 호출한다. 서버는 Google ID token 검증, session cookie 서명/검증, project membership 검사를 수행한다.

**Tech Stack:** TypeScript, Fastify 5, `@fastify/cors`, `jose`, Node `crypto`, Vitest, React 18, Vite.

## Global Constraints

- Google OAuth는 authorization code flow만 허용한다.
- 브라우저는 Google access token, ID token, Google client secret, internal API token을 저장하지 않는다.
- ID token은 issuer, audience, expiry, nonce, email_verified를 검증한다.
- `state`와 PKCE verifier는 callback에서 반드시 검증하고 1회성으로 소모한다.
- session cookie는 `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`로 설정한다.
- 로컬 개발에서만 `Secure=false`를 허용한다.
- `/admin/api/*`는 session이 없으면 401, project membership이 없으면 403을 반환한다.
- issue detail과 session timeline은 반드시 project scope와 membership을 함께 검증한다.
- CORS는 `ADMIN_APP_ORIGIN`만 허용한다.
- 수집 API `/v1/events/batch`의 allowed domain 검증은 기존처럼 project `allowedDomains` 기준으로 유지한다.
- unsafe method는 Origin/Referer 검증과 CSRF token 검증을 통과해야 한다.
- 로그인 시작과 callback은 rate limit을 적용한다.
- 인증 성공/실패, 로그아웃, 권한 거부, 프로젝트 생성은 audit log를 남긴다.
- 초기 사용자 seed 방식은 env allowlist로 시작한다: `ADMIN_ALLOWED_EMAILS`.
- PostgreSQL store가 들어오기 전까지 production 배포는 단일 인스턴스 또는 sticky session 없는 MemoryStore를 허용하지 않는다.

---

## File Structure

- `apps/api/package.json`: API dependency에 `jose`를 추가한다.
- `apps/api/src/auth/config.ts`: OAuth/session/admin origin env를 파싱하고 production guard를 제공한다.
- `apps/api/src/auth/cookies.ts`: cookie parse/serialize, signed value, hash helper를 제공한다.
- `apps/api/src/auth/csrf.ts`: admin unsafe method Origin/Referer 및 CSRF 검증을 담당한다.
- `apps/api/src/auth/session.ts`: Trace Admin session 생성, cookie 발급, request 인증 context 로드를 담당한다.
- `apps/api/src/auth/google.ts`: Google authorization URL 생성, code exchange, ID token 검증을 담당한다.
- `apps/api/src/auth/rate-limit.ts`: login start/callback in-memory rate limit을 담당한다.
- `apps/api/src/routes/auth.ts`: `/auth/google/start`, `/auth/google/callback`, `/auth/me`, `/auth/logout` 라우트.
- `apps/api/src/routes/admin-proxy.ts`: `/admin/api/*` 세션 기반 Admin BFF 라우트.
- `apps/api/src/routes/admin.ts`: 기존 token 기반 Admin 라우트를 제거하거나 compatibility 없는 내부 코드로 대체한다.
- `apps/api/src/app.ts`: CORS, auth routes, admin proxy routes 등록.
- `apps/api/src/server.ts`: env 기반 auth config 로드와 production guard 실행.
- `apps/api/src/store/types.ts`: admin user, membership, session, audit log store interface.
- `apps/api/src/store/memory-store.ts`: local/test용 admin auth store 구현.
- `apps/api/src/db/schema.sql`: admin auth 관련 table schema 추가.
- `apps/api/src/**/*.test.ts`: OAuth, session, store, route 테스트.
- `apps/admin/src/api.ts`: `VITE_TRACE_ADMIN_TOKEN` 제거, `/auth/me`, `/auth/logout`, `/admin/api/*` 호출.
- `apps/admin/src/App.tsx`: auth state machine, login/logout/403/network error 화면.
- `apps/admin/src/App.test.tsx`: Admin UI auth 상태 테스트.
- `apps/admin/src/styles.css`: 로그인, 권한 없음, 오류, header logout 스타일.
- `README.md`: Google OAuth env와 local fake OAuth smoke 절차.

## Interfaces

These interfaces are shared across tasks and must keep these exact names.

```ts
export type AdminRole = "owner" | "admin" | "viewer";

export interface AdminAuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  adminAppOrigin: string;
  sessionSecret: string;
  cookieSecure: boolean;
  allowedEmails: Set<string>;
  googleAllowedDomain?: string;
  sessionTtlSeconds: number;
  loginRateLimitWindowSeconds: number;
  loginRateLimitMax: number;
  oauthCookieName: "__trace_oauth";
  sessionCookieName: "__trace_admin_session";
  csrfCookieName: "__trace_csrf";
}

export interface AdminUserRecord {
  adminUserId: string;
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  pictureUrl?: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface AdminSessionRecord {
  sessionIdHash: string;
  adminUserId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  userAgentHash?: string;
  ipHash?: string;
}

export interface ProjectMembershipRecord {
  projectId: string;
  adminUserId: string;
  role: AdminRole;
  createdAt: string;
}

export interface AuthenticatedAdmin {
  user: AdminUserRecord;
  session: AdminSessionRecord;
  csrfToken: string;
}

export interface GoogleProfileClaims {
  sub: string;
  email: string;
  emailVerified: true;
  name?: string;
  pictureUrl?: string;
}

export interface GoogleOAuthClient {
  getAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): URL;
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<{ idToken: string }>;
  verifyIdToken(input: { idToken: string; nonce: string }): Promise<GoogleProfileClaims>;
}
```

### Task 1: Auth Config, Cookies, And Crypto Helpers

**Files:**
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Create: `apps/api/src/auth/config.ts`
- Create: `apps/api/src/auth/config.test.ts`
- Create: `apps/api/src/auth/cookies.ts`
- Create: `apps/api/src/auth/cookies.test.ts`

**Interfaces:**
- Produces: `loadAdminAuthConfig(env: NodeJS.ProcessEnv): AdminAuthConfig | undefined`
- Produces: `assertDeployableAdminAuthConfig(config: AdminAuthConfig, env: NodeJS.ProcessEnv): void`
- Produces: `parseCookieHeader(header: string | undefined): Map<string, string>`
- Produces: `serializeCookie(name: string, value: string, options: CookieOptions): string`
- Produces: `signValue(value: string, secret: string): string`
- Produces: `verifySignedValue(signedValue: string, secret: string): string | undefined`
- Produces: `hashSecret(value: string, secret: string): string`

- [ ] **Step 1: Add JWT verification dependency**

Run:

```bash
npm install jose --workspace @trace/api
```

- [ ] **Step 2: Write failing config tests**

Create `apps/api/src/auth/config.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Write failing cookie tests**

Create `apps/api/src/auth/cookies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashSecret, parseCookieHeader, serializeCookie, signValue, verifySignedValue } from "./cookies.js";

describe("cookie helpers", () => {
  it("serializes HttpOnly SameSite Lax Secure cookies", () => {
    const cookie = serializeCookie("__trace_admin_session", "abc", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60,
    });

    expect(cookie).toContain("__trace_admin_session=abc");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=60");
  });

  it("verifies signed values and rejects tampering", () => {
    const signed = signValue("raw_session", "0123456789abcdef0123456789abcdef");

    expect(verifySignedValue(signed, "0123456789abcdef0123456789abcdef")).toBe("raw_session");
    expect(verifySignedValue(`${signed}x`, "0123456789abcdef0123456789abcdef")).toBeUndefined();
  });

  it("parses repeated cookie headers with the last value winning", () => {
    expect(parseCookieHeader("a=1; b=two%20words; a=2").get("a")).toBe("2");
    expect(parseCookieHeader("a=1; b=two%20words").get("b")).toBe("two words");
  });

  it("hashes secrets without returning the raw value", () => {
    const hash = hashSecret("raw_session", "0123456789abcdef0123456789abcdef");
    expect(hash).not.toContain("raw_session");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
npm run test --workspace @trace/api -- src/auth/config.test.ts src/auth/cookies.test.ts
```

Expected: FAIL because `config.ts` and `cookies.ts` do not exist.

- [ ] **Step 5: Implement config and cookie helpers**

Create `apps/api/src/auth/config.ts` with env parsing. Defaults must be `COOKIE_SECURE=true`, `SESSION_TTL_SECONDS=28800`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS=300`, `LOGIN_RATE_LIMIT_MAX=20`. Return `undefined` when any Google OAuth required env is missing, so tests that do not use Admin OAuth can still create the app.

Create `apps/api/src/auth/cookies.ts` with Node `crypto.createHmac("sha256", secret)`, `timingSafeEqual` for signatures, URL-safe base64 for signed values, and `sha256` hex hashing for stored session IDs.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npm run test --workspace @trace/api -- src/auth/config.test.ts src/auth/cookies.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/auth/config.ts apps/api/src/auth/config.test.ts apps/api/src/auth/cookies.ts apps/api/src/auth/cookies.test.ts
git commit -m "인증: OAuth 설정과 쿠키 서명 추가"
```

### Task 2: Admin Auth Store Model

**Files:**
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Create: `apps/api/src/store/admin-auth-store.test.ts`
- Modify: `apps/api/src/db/schema.sql`

**Interfaces:**
- Consumes: `AdminRole`, `AdminUserRecord`, `AdminSessionRecord`, `ProjectMembershipRecord`
- Produces on `TraceStore`:
  - `upsertAdminUserFromGoogle(input: UpsertAdminUserFromGoogleInput): Promise<AdminUserRecord>`
  - `createAdminSession(input: CreateAdminSessionInput): Promise<AdminSessionRecord>`
  - `getAdminSession(sessionIdHash: string): Promise<AdminSessionRecord | undefined>`
  - `revokeAdminSession(sessionIdHash: string, revokedAt: string): Promise<void>`
  - `touchAdminSession(sessionIdHash: string, lastSeenAt: string): Promise<void>`
  - `addProjectMembership(input: AddProjectMembershipInput): Promise<ProjectMembershipRecord>`
  - `getProjectMembership(projectId: string, adminUserId: string): Promise<ProjectMembershipRecord | undefined>`
  - `listProjectMembershipsForUser(adminUserId: string): Promise<ProjectMembershipRecord[]>`
  - `createAuditLog(input: CreateAuditLogInput): Promise<void>`
  - `listAuditLogs(): Promise<AuditLogRecord[]>`

- [ ] **Step 1: Write failing store tests**

Create `apps/api/src/store/admin-auth-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store.js";

describe("admin auth store", () => {
  it("upserts Google users by googleSub and updates last login fields", async () => {
    const store = new MemoryStore();
    const first = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      name: "Admin",
      pictureUrl: "https://example.com/avatar.png",
      now: "2026-08-25T00:00:00.000Z",
    });
    const second = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      name: "Admin Two",
      now: "2026-08-25T01:00:00.000Z",
    });

    expect(second.adminUserId).toBe(first.adminUserId);
    expect(second.name).toBe("Admin Two");
    expect(second.lastLoginAt).toBe("2026-08-25T01:00:00.000Z");
  });

  it("stores sessions, revokes sessions, and lists project memberships", async () => {
    const store = new MemoryStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });

    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    await store.createAdminSession({
      sessionIdHash: "hash_1",
      adminUserId: user.adminUserId,
      createdAt: "2026-08-25T00:00:00.000Z",
      expiresAt: "2026-08-25T08:00:00.000Z",
      lastSeenAt: "2026-08-25T00:00:00.000Z",
    });

    expect(await store.getProjectMembership(project.projectId, user.adminUserId)).toMatchObject({ role: "owner" });
    expect(await store.listProjectMembershipsForUser(user.adminUserId)).toHaveLength(1);
    await store.revokeAdminSession("hash_1", "2026-08-25T00:10:00.000Z");
    expect((await store.getAdminSession("hash_1"))?.revokedAt).toBe("2026-08-25T00:10:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test --workspace @trace/api -- src/store/admin-auth-store.test.ts
```

Expected: FAIL because the admin auth store methods do not exist.

- [ ] **Step 3: Extend store types and MemoryStore**

Modify `apps/api/src/store/types.ts` to add the interfaces from the global interface block plus input types:

```ts
export interface UpsertAdminUserFromGoogleInput {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  pictureUrl?: string;
  now: string;
}

export interface CreateAdminSessionInput extends AdminSessionRecord {}

export interface AddProjectMembershipInput {
  projectId: string;
  adminUserId: string;
  role: AdminRole;
  createdAt: string;
}

export interface CreateAuditLogInput {
  adminUserId?: string;
  action: string;
  projectId?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}
```

Modify `MemoryStore` with private maps for admin users, admin sessions, project memberships, and audit logs. Use `nanoid(10)` for `adminUserId` as `admin_${nanoid(10)}` and for `auditLogId` as `audit_${nanoid(10)}`.

- [ ] **Step 4: Extend PostgreSQL schema**

Append these tables to `apps/api/src/db/schema.sql`:

```sql
CREATE TABLE admin_users (
  admin_user_id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL,
  name TEXT,
  picture_url TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE project_memberships (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  admin_user_id TEXT NOT NULL REFERENCES admin_users(admin_user_id),
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, admin_user_id)
);

CREATE TABLE admin_sessions (
  session_id_hash TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(admin_user_id),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent_hash TEXT,
  ip_hash TEXT
);

CREATE TABLE audit_logs (
  audit_log_id TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES admin_users(admin_user_id),
  action TEXT NOT NULL,
  project_id TEXT REFERENCES projects(project_id),
  created_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

- [ ] **Step 5: Run store tests**

Run:

```bash
npm run test --workspace @trace/api -- src/store/admin-auth-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/store/types.ts apps/api/src/store/memory-store.ts apps/api/src/store/admin-auth-store.test.ts apps/api/src/db/schema.sql
git commit -m "인증: 관리자 사용자와 세션 저장소 추가"
```

### Task 3: Session, CSRF, And Rate Limit Primitives

**Files:**
- Create: `apps/api/src/auth/session.ts`
- Create: `apps/api/src/auth/session.test.ts`
- Create: `apps/api/src/auth/csrf.ts`
- Create: `apps/api/src/auth/csrf.test.ts`
- Create: `apps/api/src/auth/rate-limit.ts`
- Create: `apps/api/src/auth/rate-limit.test.ts`

**Interfaces:**
- Consumes: `AdminAuthConfig`, `TraceStore`, cookie helpers, admin store methods.
- Produces: `createAdminSessionForUser(input): Promise<{ cookie: string; csrfCookie: string; csrfToken: string; session: AdminSessionRecord }>`
- Produces: `requireAdminSession(input): Promise<AuthenticatedAdmin | { error: "admin_auth_required" }>`
- Produces: `buildClearedAuthCookies(config: AdminAuthConfig): string[]`
- Produces: `verifyCsrfRequest(input): { ok: true } | { ok: false; statusCode: 403; error: string }`
- Produces: `createFixedWindowRateLimiter(options): { consume(key: string, nowMs?: number): boolean }`

- [ ] **Step 1: Write failing session tests**

Create `apps/api/src/auth/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAdminSessionForUser, requireAdminSession } from "./session.js";
import type { AdminAuthConfig } from "./config.js";
import { MemoryStore } from "../store/memory-store.js";

const config: AdminAuthConfig = {
  googleClientId: "client",
  googleClientSecret: "secret",
  googleRedirectUri: "http://localhost:4000/auth/google/callback",
  adminAppOrigin: "http://localhost:5173",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  cookieSecure: true,
  allowedEmails: new Set(["admin@example.com"]),
  sessionTtlSeconds: 60,
  loginRateLimitWindowSeconds: 300,
  loginRateLimitMax: 20,
  oauthCookieName: "__trace_oauth",
  sessionCookieName: "__trace_admin_session",
  csrfCookieName: "__trace_csrf",
};

describe("admin sessions", () => {
  it("creates HttpOnly session and readable CSRF cookies", async () => {
    const store = new MemoryStore();
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
    expect(result.csrfCookie).toContain("__trace_csrf=");
    expect(result.csrfCookie).not.toContain("HttpOnly");
  });

  it("rejects expired and revoked sessions", async () => {
    const store = new MemoryStore();
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
});
```

- [ ] **Step 2: Write failing CSRF and rate limit tests**

Create `apps/api/src/auth/csrf.test.ts` and `apps/api/src/auth/rate-limit.test.ts` with these assertions:

```ts
import { describe, expect, it } from "vitest";
import { verifyCsrfRequest } from "./csrf.js";

describe("csrf", () => {
  it("allows safe methods from the admin origin", () => {
    expect(verifyCsrfRequest({
      method: "GET",
      origin: "http://localhost:5173",
      referer: undefined,
      adminAppOrigin: "http://localhost:5173",
      csrfCookie: undefined,
      csrfHeader: undefined,
    })).toEqual({ ok: true });
  });

  it("rejects unsafe methods without matching Origin and CSRF token", () => {
    expect(verifyCsrfRequest({
      method: "POST",
      origin: "http://evil.example",
      referer: undefined,
      adminAppOrigin: "http://localhost:5173",
      csrfCookie: "token",
      csrfHeader: "token",
    })).toMatchObject({ ok: false, statusCode: 403 });
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter } from "./rate-limit.js";

describe("fixed window rate limiter", () => {
  it("rejects requests above the configured window max", () => {
    const limiter = createFixedWindowRateLimiter({ windowMs: 1000, max: 2 });

    expect(limiter.consume("ip_1", 0)).toBe(true);
    expect(limiter.consume("ip_1", 10)).toBe(true);
    expect(limiter.consume("ip_1", 20)).toBe(false);
    expect(limiter.consume("ip_1", 1001)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm run test --workspace @trace/api -- src/auth/session.test.ts src/auth/csrf.test.ts src/auth/rate-limit.test.ts
```

Expected: FAIL because the primitives do not exist.

- [ ] **Step 4: Implement session, CSRF, and rate limit primitives**

Create `session.ts` so it signs a random `sess_${nanoid(32)}` value, stores only `hashSecret(rawSessionId, config.sessionSecret)`, and rejects records with `revokedAt` or `expiresAt <= now`. Create `csrf.ts` so unsafe methods require `Origin` or `Referer` origin to equal `ADMIN_APP_ORIGIN` and `x-trace-csrf` to match the `__trace_csrf` cookie. Create `rate-limit.ts` as an in-memory fixed-window counter.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
npm run test --workspace @trace/api -- src/auth/session.test.ts src/auth/csrf.test.ts src/auth/rate-limit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/session.ts apps/api/src/auth/session.test.ts apps/api/src/auth/csrf.ts apps/api/src/auth/csrf.test.ts apps/api/src/auth/rate-limit.ts apps/api/src/auth/rate-limit.test.ts
git commit -m "인증: 관리자 세션과 CSRF 검증 추가"
```

### Task 4: Google OAuth Client

**Files:**
- Create: `apps/api/src/auth/google.ts`
- Create: `apps/api/src/auth/google.test.ts`

**Interfaces:**
- Consumes: `AdminAuthConfig`
- Produces: `createPkcePair(): { verifier: string; challenge: string }`
- Produces: `createOAuthNonce(): string`
- Produces: `createOAuthStateCookie(input): { state: string; nonce: string; codeVerifier: string; cookie: string }`
- Produces: `readOAuthStateCookie(input): { state: string; nonce: string; codeVerifier: string } | undefined`
- Produces: `createGoogleOAuthClient(config: AdminAuthConfig, fetchFn?: typeof fetch, options?: { jwks?: ReturnType<typeof createLocalJWKSet> }): GoogleOAuthClient`

- [ ] **Step 1: Write failing Google OAuth tests**

Create `apps/api/src/auth/google.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createGoogleOAuthClient, createOAuthStateCookie, createPkcePair, readOAuthStateCookie } from "./google.js";
import type { AdminAuthConfig } from "./config.js";

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

describe("google oauth", () => {
  it("builds an authorization URL with state nonce PKCE and OIDC scopes", () => {
    const client = createGoogleOAuthClient(config);
    const url = client.getAuthorizationUrl({ state: "state_1", nonce: "nonce_1", codeChallenge: "challenge_1" });

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(config.googleClientId);
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.searchParams.get("state")).toBe("state_1");
    expect(url.searchParams.get("nonce")).toBe("nonce_1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("round-trips signed one-time OAuth state cookie content", () => {
    const created = createOAuthStateCookie({ config, now: new Date("2026-08-25T00:00:00.000Z") });
    const parsed = readOAuthStateCookie({
      config,
      cookieHeader: created.cookie.split(";")[0],
      now: new Date("2026-08-25T00:05:00.000Z"),
    });

    expect(parsed?.state).toBe(created.state);
    expect(parsed?.nonce).toBe(created.nonce);
    expect(parsed?.codeVerifier).toBe(created.codeVerifier);
  });

  it("exchanges an authorization code through Google's token endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: "id.jwt" }),
    });
    const client = createGoogleOAuthClient(config, fetchFn as never);

    await expect(client.exchangeCode({ code: "code_1", codeVerifier: "verifier_1" })).resolves.toEqual({ idToken: "id.jwt" });
    expect(fetchFn.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
  });

  it("creates an S256 PKCE challenge", () => {
    const pair = createPkcePair();
    expect(pair.verifier.length).toBeGreaterThan(40);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test --workspace @trace/api -- src/auth/google.test.ts
```

Expected: FAIL because `google.ts` does not exist.

- [ ] **Step 3: Implement Google OAuth client**

Create `google.ts` using `jose.createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))` and `jwtVerify(idToken, jwks, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: config.googleClientId })`. After JWT verification, reject when `payload.nonce !== input.nonce`, `payload.email_verified !== true`, `payload.email` is missing, `GOOGLE_ALLOWED_DOMAIN` does not match `payload.hd`, or `ADMIN_ALLOWED_EMAILS` does not include the lower-cased email.

- [ ] **Step 4: Add an ID token verification test with injected JWKS**

Extend `createGoogleOAuthClient` with an optional third argument:

```ts
{ jwks?: ReturnType<typeof createLocalJWKSet> }
```

Append these tests to `apps/api/src/auth/google.test.ts` and add `createLocalJWKSet`, `exportJWK`, `generateKeyPair`, and `SignJWT` to the `jose` import:

```ts
async function signedGoogleIdToken(overrides: Record<string, unknown> = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key" }] });
  const now = Math.floor(new Date("2026-08-25T00:00:00.000Z").getTime() / 1000);
  const { aud, exp, ...claimOverrides } = overrides;
  const idToken = await new SignJWT({
    nonce: "nonce_1",
    email: "admin@example.com",
    email_verified: true,
    name: "Admin",
    picture: "https://example.com/avatar.png",
    ...claimOverrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience(String(aud ?? config.googleClientId))
    .setSubject("google_sub_1")
    .setIssuedAt(now)
    .setExpirationTime(Number(exp ?? now + 60))
    .sign(privateKey);

  return { idToken, jwks };
}

it("verifies ID token claims and normalizes Google profile claims", async () => {
  const { idToken, jwks } = await signedGoogleIdToken();
  const client = createGoogleOAuthClient(config, undefined, { jwks });

  await expect(client.verifyIdToken({ idToken, nonce: "nonce_1" })).resolves.toEqual({
    sub: "google_sub_1",
    email: "admin@example.com",
    emailVerified: true,
    name: "Admin",
    pictureUrl: "https://example.com/avatar.png",
  });
});

it("rejects wrong nonce, wrong audience, expired tokens, and unverified email", async () => {
  const valid = await signedGoogleIdToken();
  const wrongAudience = await signedGoogleIdToken({ aud: "other-client" });
  const expired = await signedGoogleIdToken({ exp: Math.floor(new Date("2026-08-24T23:59:00.000Z").getTime() / 1000) });
  const unverified = await signedGoogleIdToken({ email_verified: false });

  await expect(createGoogleOAuthClient(config, undefined, { jwks: valid.jwks }).verifyIdToken({
    idToken: valid.idToken,
    nonce: "wrong_nonce",
  })).rejects.toThrow("nonce");
  await expect(createGoogleOAuthClient(config, undefined, { jwks: wrongAudience.jwks }).verifyIdToken({
    idToken: wrongAudience.idToken,
    nonce: "nonce_1",
  })).rejects.toThrow();
  await expect(createGoogleOAuthClient(config, undefined, { jwks: expired.jwks }).verifyIdToken({
    idToken: expired.idToken,
    nonce: "nonce_1",
  })).rejects.toThrow();
  await expect(createGoogleOAuthClient(config, undefined, { jwks: unverified.jwks }).verifyIdToken({
    idToken: unverified.idToken,
    nonce: "nonce_1",
  })).rejects.toThrow("email_verified");
});
```

- [ ] **Step 5: Run Google OAuth tests**

Run:

```bash
npm run test --workspace @trace/api -- src/auth/google.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/google.ts apps/api/src/auth/google.test.ts
git commit -m "인증: Google OAuth 클라이언트 추가"
```

### Task 5: Auth Routes

**Files:**
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/auth.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `AdminAuthConfig`, `GoogleOAuthClient`, session primitives, CSRF primitives, rate limiter, admin store.
- Produces routes:
  - `GET /auth/google/start`
  - `GET /auth/google/callback`
  - `GET /auth/me`
  - `POST /auth/logout`
- Produces response shape:

```ts
export interface AuthMeResponse {
  user: { adminUserId: string; email: string; name?: string; pictureUrl?: string };
  projects: Array<{ projectId: string; role: AdminRole }>;
  csrfToken: string;
}
```

- [ ] **Step 1: Write failing auth route tests**

Create `apps/api/src/routes/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
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
  it("redirects Google login start and sets an OAuth state cookie", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });

    const response = await app.inject({ method: "GET", url: "/auth/google/start", headers: { origin: config.adminAppOrigin } });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("https://accounts.google.com");
    expect(response.headers["set-cookie"]).toString().toContain("__trace_oauth=");
  });

  it("exchanges callback code, creates session cookies, and redirects to the Admin app", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });
    const start = await app.inject({ method: "GET", url: "/auth/google/start", headers: { origin: config.adminAppOrigin } });
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    const oauthCookie = Array.isArray(start.headers["set-cookie"]) ? start.headers["set-cookie"][0] : String(start.headers["set-cookie"]);

    const callback = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=code_1&state=${state}`,
      headers: { cookie: oauthCookie.split(";")[0] },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(config.adminAppOrigin);
    expect(callback.headers["set-cookie"]).toString().toContain("__trace_admin_session=");
  });

  it("returns auth/me for a valid session and 401 without a session", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });
    const start = await app.inject({ method: "GET", url: "/auth/google/start" });
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    const oauthCookie = Array.isArray(start.headers["set-cookie"]) ? start.headers["set-cookie"][0] : String(start.headers["set-cookie"]);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test --workspace @trace/api -- src/routes/auth.test.ts
```

Expected: FAIL because auth routes are not registered.

- [ ] **Step 3: Implement auth routes and app wiring**

Modify `createApp` signature to:

```ts
export function createApp(options: {
  store: TraceStore;
  authConfig?: AdminAuthConfig | undefined;
  googleOAuthClient?: GoogleOAuthClient | undefined;
})
```

Register `registerAuthRoutes` when `authConfig` exists. In `/auth/google/callback`, clear the OAuth state cookie after any valid callback attempt, create/update the admin user, create the session, audit `auth.login_success`, and redirect to `config.adminAppOrigin`. On state mismatch or token verification failure, audit `auth.login_failure` and return 401.

Replace global `app.register(cors, { origin: true })` with an origin policy that only grants credentialed browser access to `/auth/*` and `/admin/api/*` when `Origin` equals `config.adminAppOrigin`. Keep `/v1/events/batch` callable from SDK origins and keep the existing project `allowedDomains` enforcement inside `registerIngestionRoutes`.

Modify `server.ts` to call `loadAdminAuthConfig(process.env)` and `assertDeployableAdminAuthConfig` before `createApp`.

- [ ] **Step 4: Add logout and failure route tests**

Extend `auth.test.ts` with:

```ts
it("logs out with CSRF and clears auth cookies", async () => {
  const app = createApp({ store: new MemoryStore(), authConfig: config, googleOAuthClient: fakeGoogleClient() });
  const start = await app.inject({ method: "GET", url: "/auth/google/start" });
  const state = new URL(String(start.headers.location)).searchParams.get("state");
  const oauthCookie = Array.isArray(start.headers["set-cookie"]) ? start.headers["set-cookie"][0] : String(start.headers["set-cookie"]);
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
```

- [ ] **Step 5: Run auth route tests**

Run:

```bash
npm run test --workspace @trace/api -- src/routes/auth.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/src/routes/auth.test.ts apps/api/src/app.ts apps/api/src/server.ts
git commit -m "인증: Google OAuth 라우트 추가"
```

### Task 6: Session-Based Admin BFF Routes

**Files:**
- Create: `apps/api/src/routes/admin-proxy.ts`
- Modify: `apps/api/src/routes/admin.test.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `requireAdminSession`, `verifyCsrfRequest`, `TraceStore.getProjectMembership`
- Produces routes under `/admin/api/*`:
  - `POST /admin/api/projects`
  - `GET /admin/api/projects/:projectId/summary`
  - `GET /admin/api/projects/:projectId/issues`
  - `GET /admin/api/issues/:issueId?projectId=...`
  - `GET /admin/api/sessions/:sessionId/timeline?projectId=...`

- [ ] **Step 1: Write failing Admin BFF tests**

Replace `apps/api/src/routes/admin.test.ts` with session-based tests:

```ts
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
  const session = await createAdminSessionForUser({ store, config: authConfig, user, now: new Date("2026-08-25T00:00:00.000Z") });
  return { store, user, cookie: `${session.cookie.split(";")[0]}; ${session.csrfCookie.split(";")[0]}`, csrfToken: session.csrfToken };
}

describe("admin bff routes", () => {
  it("rejects Admin BFF requests without a session cookie", async () => {
    const app = createApp({ store: new MemoryStore(), authConfig });
    const response = await app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/summary" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "admin_auth_required" });
  });

  it("creates a project and grants owner membership to the creator", async () => {
    const { store, user, cookie, csrfToken } = await signedInStore();
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
    expect(await store.getProjectMembership(body.projectId, user.adminUserId)).toMatchObject({ role: "owner" });
  });

  it("returns 403 when the signed-in admin lacks project membership", async () => {
    const { store, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Private", allowedDomains: ["https://private.example.com"] });
    const app = createApp({ store, authConfig });

    const response = await app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/summary`, headers: { cookie } });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "project_access_denied" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test --workspace @trace/api -- src/routes/admin.test.ts
```

Expected: FAIL because `/admin/api/*` routes do not exist.

- [ ] **Step 3: Implement Admin BFF routes**

Create `admin-proxy.ts`. Each route must call `requireAdminSession`. For project-scoped reads, return 404 when the project or issue does not exist, then return 403 when `getProjectMembership(projectId, user.adminUserId)` is absent. For `POST /admin/api/projects`, require CSRF and create an owner membership for the creator.

Keep `apps/api/src/routes/admin.ts` only if it is useful as private route helpers. Do not register token-based `/api/*` Admin routes in `createApp`.

- [ ] **Step 4: Add project scope regression tests**

Append this test to `apps/api/src/routes/admin.test.ts`:

```ts
it("does not leak issue detail or session timeline across project scope", async () => {
  const { store, user, cookie } = await signedInStore();
  const memberProject = await store.createProject({ name: "Member", allowedDomains: ["https://member.example.com"] });
  const otherProject = await store.createProject({ name: "Other", allowedDomains: ["https://other.example.com"] });
  await store.addProjectMembership({
    projectId: memberProject.projectId,
    adminUserId: user.adminUserId,
    role: "owner",
    createdAt: "2026-08-25T00:00:00.000Z",
  });
  await store.saveBatch({
    projectId: memberProject.projectId,
    anonymousUserId: "anon_1",
    sessionId: "sess_1",
    sentAt: "2026-08-25T00:00:03.000Z",
    sdkVersion: "0.1.0",
    url: "https://member.example.com/settings",
    events: [{
      eventId: "evt_1",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-08-25T00:00:00.000Z",
      type: "click",
      urlPath: "/settings",
      metadata: {},
    }],
  });
  await store.upsertIssues(memberProject.projectId, [{
    issueId: "issue_1",
    projectId: memberProject.projectId,
    issueType: "rage_click",
    title: "설정 화면에서 반복 클릭",
    summary: "같은 버튼을 반복 클릭했습니다.",
    affectedSessionsCount: 1,
    affectedUsersCount: 1,
    severityScore: 70,
    firstSeenAt: "2026-08-25T00:00:00.000Z",
    lastSeenAt: "2026-08-25T00:00:00.000Z",
    trend: "flat",
    relatedUrlPath: "/settings",
    exampleSessionIds: ["sess_1"],
    status: "new",
  }]);
  const app = createApp({ store, authConfig });

  const issueResponse = await app.inject({
    method: "GET",
    url: `/admin/api/issues/issue_1?projectId=${otherProject.projectId}`,
    headers: { cookie },
  });
  const timelineResponse = await app.inject({
    method: "GET",
    url: `/admin/api/sessions/sess_1/timeline?projectId=${otherProject.projectId}`,
    headers: { cookie },
  });

  expect(issueResponse.statusCode).toBe(404);
  expect(timelineResponse.statusCode).toBe(403);
});
```

- [ ] **Step 5: Run Admin route tests**

Run:

```bash
npm run test --workspace @trace/api -- src/routes/admin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts apps/api/src/app.ts
git commit -m "인증: 세션 기반 Admin BFF로 전환"
```

### Task 7: Admin UI Auth State And Cookie Requests

**Files:**
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/App.test.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `/auth/me`, `/auth/logout`, `/admin/api/*`
- Produces in `apps/admin/src/api.ts`:
  - `getAuthMe(): Promise<AuthMeResponse>`
  - `logout(csrfToken: string): Promise<void>`
  - `getDashboardData(projectId: string): Promise<{ summary: DashboardSummary; issues: Issue[] }>`
  - `getIssueDetail(projectId: string, issueId: string): Promise<Issue>`
  - `getSessionTimeline(projectId: string, sessionId: string): Promise<SessionTimelineEvent[]>`
  - `ApiError` with `status: number`

- [ ] **Step 1: Write failing UI auth tests**

Replace `apps/admin/src/App.test.tsx` with tests that mock API outcomes:

```tsx
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const api = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
  getAuthMe: vi.fn(),
  getDashboardData: vi.fn(),
  logout: vi.fn(),
  getIssueDetail: vi.fn(),
  getSessionTimeline: vi.fn(),
}));

vi.mock("./api", () => ({
  ApiError: api.ApiError,
  getAuthMe: api.getAuthMe,
  getDashboardData: api.getDashboardData,
  logout: api.logout,
  getIssueDetail: api.getIssueDetail,
  getSessionTimeline: api.getSessionTimeline,
}));

beforeEach(() => {
  api.getDashboardData.mockResolvedValue({
    summary: {
      frictionScore: 82,
      affectedSessionsCount: 312,
      newIssuesCount: 14,
      resolvedOrIgnoredIssuesCount: 6,
      insight: "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다.",
      trend: [{ date: "2026-08-24", score: 82 }],
      issueTypeDistribution: [{ issueType: "rage_click", count: 4 }],
      topTargets: [{ label: "/settings", count: 42 }],
    },
    issues: [{
      issueId: "issue_1",
      projectId: "proj_demo",
      issueType: "rage_click",
      title: "설정 화면에서 반복 클릭",
      summary: "같은 버튼을 반복 클릭했습니다.",
      affectedSessionsCount: 42,
      affectedUsersCount: 42,
      severityScore: 82,
      firstSeenAt: "2026-08-24T00:00:00.000Z",
      lastSeenAt: "2026-08-24T00:00:00.000Z",
      trend: "up",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new",
    }],
  });
});

describe("App auth state", () => {
  it("renders a Google login screen on auth/me 401", async () => {
    api.getAuthMe.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));
    render(<App />);
    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
  });

  it("renders dashboard after auth/me succeeds", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    render(<App />);
    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();
    expect(await screen.findByText("설정 화면에서 반복 클릭")).toBeInTheDocument();
  });

  it("posts logout with the CSRF token", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    expect(api.logout).toHaveBeenCalledWith("csrf_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: FAIL because `ApiError`, `getAuthMe`, and logout UI do not exist.

- [ ] **Step 3: Implement Admin API client**

Modify `apps/admin/src/api.ts` to remove `VITE_TRACE_ADMIN_TOKEN` and use:

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const DEFAULT_PROJECT_ID = import.meta.env.VITE_PROJECT_ID;
const credentialedFetch = (path: string, init: RequestInit = {}) =>
  fetch(`${API_BASE}${path}`, { ...init, credentials: "include" });
```

Throw `new ApiError(response.status, error)` for non-2xx responses. Route paths must be `/auth/me`, `/auth/logout`, `/admin/api/projects/:projectId/summary`, `/admin/api/projects/:projectId/issues`, `/admin/api/issues/:issueId?projectId=...`, and `/admin/api/sessions/:sessionId/timeline?projectId=...`.

- [ ] **Step 4: Implement App auth state**

Modify `App.tsx` to load `/auth/me` first. If it returns 401, render a login screen with a button that sets `window.location.href = `${API_BASE}/auth/google/start``. If the authenticated user has no projects and `VITE_PROJECT_ID` is absent, render a Korean empty project state. Pick `VITE_PROJECT_ID` when present; otherwise use the first project from `/auth/me`.

- [ ] **Step 5: Update dashboard header logout**

Modify `DashboardPage.tsx` to accept:

```ts
userEmail: string;
onLogout: () => void;
```

Render the email in the header and a `로그아웃` button. Keep the dashboard layout compact and avoid nested cards.

- [ ] **Step 6: Run UI tests**

Run:

```bash
npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/api.ts apps/admin/src/App.tsx apps/admin/src/App.test.tsx apps/admin/src/pages/DashboardPage.tsx apps/admin/src/styles.css
git commit -m "관리자: OAuth 세션 기반 로그인 화면 추가"
```

### Task 8: Documentation, Secret Scan, And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-25-admin-google-oauth-design.md`

**Interfaces:**
- Consumes: all completed implementation.
- Produces: documented local and deployment setup.

- [ ] **Step 1: Update README local auth instructions**

Replace the `TRACE_ADMIN_TOKEN` and `VITE_TRACE_ADMIN_TOKEN` local flow with:

```bash
GOOGLE_CLIENT_ID=<client-id> \
GOOGLE_CLIENT_SECRET=<client-secret> \
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback \
SESSION_SECRET=<32+ byte random string> \
ADMIN_APP_ORIGIN=http://localhost:5173 \
ADMIN_ALLOWED_EMAILS=admin@example.com \
COOKIE_SECURE=false \
npm run dev:api
```

Admin:

```bash
VITE_PROJECT_ID=<projectId> npm run dev:admin
```

State that production requires HTTPS, `COOKIE_SECURE=true`, fixed `ADMIN_APP_ORIGIN`, and a durable shared session store before multi-instance deployment.

- [ ] **Step 2: Update design document rollout status**

Add a short "Implementation Status" section to the Google OAuth design spec with the implemented route names and verification commands.

- [ ] **Step 3: Run API tests**

Run:

```bash
npm run test --workspace @trace/api
```

Expected: PASS.

- [ ] **Step 4: Run Admin tests**

Run:

```bash
npm run test --workspace @trace/admin
```

Expected: PASS.

- [ ] **Step 5: Run full repo verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands PASS. The existing Vite chunk-size warning is acceptable if no new warning type appears.

- [ ] **Step 6: Scan built Admin bundle for secrets**

Run:

```bash
rg "GOOGLE_CLIENT_SECRET|SESSION_SECRET|TRACE_ADMIN_TOKEN|VITE_TRACE_ADMIN_TOKEN" apps/admin/dist apps/admin/src apps/api/src README.md
```

Expected: no matches in `apps/admin/dist` or `apps/admin/src`. Matches in server source or README are acceptable only when they are env variable names, not secret values.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/superpowers/specs/2026-08-25-admin-google-oauth-design.md
git commit -m "문서: Google OAuth 관리자 인증 절차 정리"
```

## Final Review Checklist

- [ ] `VITE_TRACE_ADMIN_TOKEN` is removed from Admin runtime code.
- [ ] No Google token or internal admin token is exposed to the browser.
- [ ] `/auth/google/start` creates state, nonce, PKCE verifier, and redirects to Google.
- [ ] `/auth/google/callback` validates state, exchanges code, verifies ID token, creates a Trace session, and clears the OAuth cookie.
- [ ] Session cookie has `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` outside local development.
- [ ] `/auth/me` returns authenticated user, project memberships, and CSRF token.
- [ ] `/auth/logout` requires CSRF and revokes the session.
- [ ] `/admin/api/*` returns 401 without session and 403 without project membership.
- [ ] Issue detail and session timeline cannot leak data across projects.
- [ ] Ingestion domain validation still uses project `allowedDomains`.
- [ ] Login start and callback have rate limiting.
- [ ] Auth success/failure, logout, denied access, and project creation write audit logs.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` pass.
