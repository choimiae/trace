# 로컬 전용 간편 로그인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 개발 환경에서 Google OAuth 설정 없이 관리자 세션을 만들 수 있는 간편 로그인 흐름을 추가한다.

**Architecture:** `AdminAuthConfig`를 Google OAuth와 로컬 로그인 모드를 함께 표현하도록 확장한다. Auth route는 기존 session/CSRF/audit helper를 재사용하고, Admin UI는 `GET /auth/login-options` 결과로 로그인 버튼을 결정한다.

**Tech Stack:** Fastify, TypeScript, React, Vitest, Testing Library.

## Global Constraints

- 로컬 로그인은 `NODE_ENV=development` 또는 `NODE_ENV=test`에서만 허용한다.
- production에서는 Google OAuth 설정이 계속 필수다.
- 기존 Google OAuth route와 session cookie 이름은 유지한다.
- 사용자-facing copy는 한국어를 사용한다.

---

### Task 1: Auth Config and App Registration

**Files:**
- Modify: `apps/api/src/auth/config.ts`
- Modify: `apps/api/src/auth/config.test.ts`
- Modify: `apps/api/src/startup.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Produces: `AdminAuthConfig.googleOAuthEnabled: boolean`
- Produces: `AdminAuthConfig.localAdminLoginEnabled: boolean`

- [ ] **Step 1: Write failing config tests**

Add tests for local-only config creation and production rejection.

- [ ] **Step 2: Run config/startup tests and verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/auth/config.test.ts src/startup.test.ts`

- [ ] **Step 3: Implement config mode flags**

Make Google OAuth fields optional inside `AdminAuthConfig`, parse `LOCAL_ADMIN_LOGIN`, and reject it outside development/test.

- [ ] **Step 4: Run config/startup tests and typecheck**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/auth/config.test.ts src/startup.test.ts`

### Task 2: Local Auth Routes

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/routes/auth.test.ts`

**Interfaces:**
- Produces: `GET /auth/login-options`
- Produces: `GET /auth/local/start`

- [ ] **Step 1: Write failing route tests**

Cover login options, local login redirect, session bootstrap, disabled local login, and Google route disabled when Google config is absent.

- [ ] **Step 2: Run route tests and verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/auth.test.ts`

- [ ] **Step 3: Implement routes**

Add login options and local start route. Guard Google start/callback when OAuth is unavailable.

- [ ] **Step 4: Run route tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/auth.test.ts`

### Task 3: Admin UI Login Options

**Files:**
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/App.test.tsx`
- Modify: `apps/admin/src/pages/StatusPage.tsx`

**Interfaces:**
- Consumes: `GET /auth/login-options`

- [ ] **Step 1: Write failing UI tests**

Cover local button rendering/click and the existing Google-only fallback.

- [ ] **Step 2: Run admin tests and verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx`

- [ ] **Step 3: Implement UI state**

Fetch login options on 401 and render actions accordingly.

- [ ] **Step 4: Run admin tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx`

### Task 4: Documentation and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Document local login env and production OAuth requirement.

- [ ] **Step 2: Run full verification**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test
git diff --check
git status --short
```
