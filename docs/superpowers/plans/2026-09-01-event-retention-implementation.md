# 이벤트 보관 기간 정책 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `EVENT_RETENTION_DAYS` 설정으로 cutoff 이전 원본 이벤트를 자동 삭제한다.

**Architecture:** Store 계약에 `deleteEventsBefore(cutoff: string)`를 추가해 Memory/SQLite 구현을 맞춘다. API 서버 시작과 ingestion 성공 후 retention runner를 호출하고, `issues`와 audit/admin 데이터는 건드리지 않는다.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Vitest.

## Global Constraints

- 삭제 대상은 `events`뿐이다.
- `issues`는 삭제하지 않는다.
- `EVENT_RETENTION_DAYS`가 없으면 자동 삭제하지 않는다.
- `EVENT_RETENTION_DAYS`는 양의 안전 정수만 허용한다.

---

### Task 1: Store Event Deletion Contract

**Files:**
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Produces: `TraceStore.deleteEventsBefore(cutoff: string): Promise<number>`

- [ ] **Step 1: Write failing store contract test**

Add a test that saves events before, at, and after a cutoff, calls `deleteEventsBefore`, and asserts only older events are removed.

- [ ] **Step 2: Run store contract test and verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts`

- [ ] **Step 3: Implement MemoryStore and SqliteStore deletion**

MemoryStore filters each project event array. SqliteStore runs `DELETE FROM events WHERE timestamp < ?` and returns `changes`.

- [ ] **Step 4: Run store contract test**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts`

### Task 2: Retention Config and Runner

**Files:**
- Create: `apps/api/src/retention/config.ts`
- Create: `apps/api/src/retention/config.test.ts`
- Create: `apps/api/src/retention/events.ts`
- Create: `apps/api/src/retention/events.test.ts`

**Interfaces:**
- Produces: `loadEventRetentionConfig(env: NodeJS.ProcessEnv): { eventRetentionDays?: number }`
- Produces: `eventRetentionCutoff(now: Date, days: number): string`
- Produces: `runEventRetention(store: TraceStore, config: EventRetentionConfig, now?: Date): Promise<number>`

- [ ] **Step 1: Write failing config and runner tests**

Cover undefined config, valid days, invalid days, cutoff calculation, and no-op when unset.

- [ ] **Step 2: Run tests and verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/retention/config.test.ts src/retention/events.test.ts`

- [ ] **Step 3: Implement config and runner**

Parse `EVENT_RETENTION_DAYS`, compute cutoff, call `deleteEventsBefore`.

- [ ] **Step 4: Run retention tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/retention/config.test.ts src/retention/events.test.ts`

### Task 3: Server and Ingestion Wiring

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/ingestion.ts`
- Modify: `apps/api/src/routes/ingestion.test.ts`
- Modify: `apps/api/src/startup.ts`

**Interfaces:**
- Consumes: `EventRetentionConfig`
- Consumes: `runEventRetention`

- [ ] **Step 1: Write failing ingestion test**

Configure retention for one day, ingest old and new events, and assert the old event is removed after the request.

- [ ] **Step 2: Run ingestion test and verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/ingestion.test.ts`

- [ ] **Step 3: Wire retention config**

Load retention config in startup/server, pass it to `createApp`, and call retention after successful ingestion.

- [ ] **Step 4: Run API focused tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/ingestion.test.ts src/startup.test.ts`

### Task 4: Docs and Final Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document `EVENT_RETENTION_DAYS`**

Add the optional env var and explain that only `events` are pruned.

- [ ] **Step 2: Run final verification**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build
git diff --check
git status --short
```
