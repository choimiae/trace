# 새 프로젝트 생성 진입점 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 프로젝트가 있는 상태에서도 대시보드에서 새 프로젝트를 만들 수 있게 한다.

**Architecture:** `DashboardPage`에 `onCreateProject` prop과 `새 프로젝트` 버튼을 추가한다. `App.ready` 상태에서 이 prop을 받아 기존 `create-project` 상태로 전환하고, 생성 성공 후 기존 설치 안내 흐름을 재사용한다.

**Tech Stack:** React, TypeScript, Testing Library, Vitest.

## Global Constraints

- 기존 `CreateProjectPage`를 재사용한다.
- 프로젝트 생성 API 계약은 바꾸지 않는다.
- 생성 성공 후 새 프로젝트 ID를 `trace.selectedProjectId`에 저장한다.

---

### Task 1: Dashboard Button

**Files:**
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Test: `apps/admin/src/pages/DashboardPage.test.tsx`

- [x] **Step 1: Write failing component test**

Assert that clicking `새 프로젝트` calls `onCreateProject`.

- [x] **Step 2: Run test and verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/DashboardPage.test.tsx`

- [x] **Step 3: Add button and prop**

Add `onCreateProject` prop and render `새 프로젝트` in header actions.

- [x] **Step 4: Run component test**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/DashboardPage.test.tsx`

### Task 2: App State Wiring

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Test: `apps/admin/src/App.test.tsx`

- [x] **Step 1: Write failing App test**

Start from a ready dashboard, click `새 프로젝트`, create it, and assert the install snippet uses the new `projectId`.

- [x] **Step 2: Run test and verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx`

- [x] **Step 3: Wire App prop**

Pass `onCreateProject={() => setState({ type: "create-project", csrfToken: state.csrfToken })}` to `DashboardPage`.

- [x] **Step 4: Run App test**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx`

### Task 3: Final Verification

**Files:** none by default.

- [x] **Step 1: Run full verification**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build
git diff --check
```
