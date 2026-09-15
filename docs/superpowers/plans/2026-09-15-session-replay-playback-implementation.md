# 세션 리플레이 재생 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기록이 올라온 세션을 관리자 화면 목록에서 찾아 rrweb 으로 재생한다.

**Architecture:** 서버는 청크를 **풀지 않는다** — 매니페스트(청크 목록)와 본문을 분리하고, 본문은 DB 의 gzip BLOB 를 `Content-Encoding: gzip` 으로 그대로 흘려보낸다. 브라우저가 투명하게 풀어 `response.json()` 이 동작한다. 화면은 seq 0 부터 청크를 받아 이어 붙이되 **첫 청크가 도착하면 바로 재생을 시작**하고 나머지는 `replayer.addEvent` 로 채운다. 조립은 순수 모듈로 분리해 `Replayer` 없이 테스트한다.

**Tech Stack:** TypeScript, rrweb 2.0.0-alpha.4 (`Replayer`), Fastify 5, better-sqlite3, zod 3, React 18, vitest 2 (API 는 node, admin 은 jsdom)

**Spec:** `docs/superpowers/specs/2026-09-15-session-replay-playback-design.md`

## Global Constraints

- **서버는 재생을 위해 gzip 을 풀지 않는다.** 이 계획에서 가장 중요한 불변식이다. 청크 라우트는 DB BLOB 를 바이트 그대로 보낸다.
- **두 스토어 구현(`MemoryStore`·`SqliteStore`)은 동작이 같아야 한다.** 새 메서드는 `apps/api/src/store/store-contract.test.ts` 한 곳에 테스트를 쓰고 두 구현이 함께 통과해야 한다.
- **rrweb 이벤트 본문은 검증하지 않는다.** 모양이 rrweb 버전에 묶여 있다(A 스펙 §5). 조립은 `events` 배열을 꺼내 이어 붙일 뿐이다.
- **조회자(viewer)도 재생을 볼 수 있다.** 세 라우트 모두 `getProjectAccess` 만 통과하면 200 이다. 역할로 분기하지 않는다.
- **접근 거부는 감사 로그에 남는다.** 기존 `auditProjectAccessDenied` 를 그대로 탄다.
- **기록이 없으면 404 가 아니라 빈 배열이다.** 보존 경과와 트리거 미발생을 화면이 구분하지 않는다.
- **`Cache-Control: no-store`** 를 매니페스트·청크·목록 세 응답 모두에 건다. 기록은 저장소에서 가장 민감한 데이터다.
- **재생 화면은 lazy import 로 별도 청크로 뺀다.** 차트(`FrictionTrendChart`·`IssueTypeChart`)가 이미 그 패턴이다. 재생을 열지 않는 운영자는 rrweb 을 받지 않는다.
- **`package-lock.json` 은 커밋하지 않는다.** npm install 이 건드리면 `git checkout -- package-lock.json` 으로 되돌린다. 단 Task 8 의 rrweb 의존성 추가는 예외 — 그때는 lock 변경이 의도한 산출물이다.
- 테스트 명령: 루트에서 `npm test`. 개별은 `npm test --workspace @trace/api` / `@trace/admin`. 타입은 `npm run typecheck`.
- 커밋 메시지는 한국어다(`AGENTS.md`). 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` 를 붙인다.

---

## File Structure

**생성**

| 파일 | 책임 |
|---|---|
| `apps/admin/src/replay/assemble.ts` | 청크 본문 → 이벤트 배열. 순수 함수, `Replayer` 없이 테스트한다 |
| `apps/admin/src/replay/assemble.test.ts` | 위의 테스트 |
| `apps/admin/src/replay/player.ts` | rrweb `Replayer` 를 감싸는 경계. jsdom 에서 돌지 않으므로 화면은 이것을 주입받는다 |
| `apps/admin/src/pages/SessionReplayPage.tsx` | 재생 화면 |
| `apps/admin/src/pages/SessionReplayPage.test.tsx` | 위의 테스트 (가짜 player 주입) |
| `apps/admin/src/components/RecordedSessionTable.tsx` | 기록된 세션 목록 표 |
| `apps/admin/src/components/RecordedSessionTable.test.tsx` | 위의 테스트 |
| `apps/api/src/routes/admin-recording.test.ts` | 세 라우트의 테스트 |

**수정**

| 파일 | 무엇을 |
|---|---|
| `apps/api/src/store/types.ts` | `RecordedSessionSummary` 타입, `listRecordedSessions` 계약 |
| `apps/api/src/store/memory-store.ts` | `listRecordedSessions` 구현 |
| `apps/api/src/store/sqlite-store.ts` | `listRecordedSessions` 구현 (group by) |
| `apps/api/src/store/store-contract.test.ts` | 집계 계약 테스트 |
| `apps/api/src/routes/admin-proxy.ts` | 라우트 3개, `ProjectResourceType` 에 `session_recording` |
| `apps/admin/src/api.ts` | 응답 타입 3개, 조회 함수 3개 |
| `apps/admin/src/App.tsx` | `replay` 상태 추가, 재생 화면 lazy 렌더 |
| `apps/admin/src/pages/DashboardPage.tsx` | 「기록된 세션」 `Card` |
| `apps/admin/src/pages/pages.css` | 재생 화면·목록 스타일 |
| `apps/admin/package.json` | `rrweb` 의존성 |
| `README.md` | 재생 경로 한 줄 |

---

## Task 1: store 계약 — `listRecordedSessions`

**Files:**
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: 기존 `saveSessionRecordingChunk`
- Produces: `RecordedSessionSummary`, `listRecordedSessions(projectId: string, limit: number): Promise<RecordedSessionSummary[]>`

- [ ] **Step 1: 실패하는 계약 테스트를 쓴다**

`store-contract.test.ts` 안, `describeTraceStoreContract` 의 본문에 더한다. 이 파일은 `MemoryStore` 와 `SqliteStore` 를 같은 본문으로 돌리고, 각 테스트는 **`open()`** 으로 스토어를 얻는다(`createStore()` 를 직접 부르지 않는다 — `dispose` 를 러너가 관리한다).

```ts
it("기록된 세션을 최근 순으로 집계한다", async () => {
  const store = open();
  const chunk = (sessionId: string, seq: number, receivedAt: string, eventCount: number) => ({
    sessionId,
    projectId: "proj_a",
    seq,
    startedAt: "2026-09-15T00:00:00.000Z",
    receivedAt,
    eventCount,
    bytes: new Uint8Array([1, 2, 3]),
  });

  await store.saveSessionRecordingChunk(chunk("sess_old", 0, "2026-09-15T00:00:00.000Z", 2));
  await store.saveSessionRecordingChunk(chunk("sess_new", 0, "2026-09-15T01:00:00.000Z", 3));
  await store.saveSessionRecordingChunk(chunk("sess_new", 1, "2026-09-15T01:05:00.000Z", 4));

  const sessions = await store.listRecordedSessions("proj_a", 50);

  expect(sessions.map((s) => s.sessionId)).toEqual(["sess_new", "sess_old"]);
  expect(sessions[0]).toEqual({
    sessionId: "sess_new",
    startedAt: "2026-09-15T00:00:00.000Z",
    lastReceivedAt: "2026-09-15T01:05:00.000Z",
    chunkCount: 2,
    eventCount: 7,
    bytes: 6,
  });
});

it("다른 프로젝트의 기록은 섞이지 않는다", async () => {
  const store = open();
  const base = {
    seq: 0,
    startedAt: "2026-09-15T00:00:00.000Z",
    receivedAt: "2026-09-15T00:00:00.000Z",
    eventCount: 1,
    bytes: new Uint8Array([1]),
  };
  await store.saveSessionRecordingChunk({ ...base, sessionId: "sess_a", projectId: "proj_a" });
  await store.saveSessionRecordingChunk({ ...base, sessionId: "sess_b", projectId: "proj_b" });

  expect((await store.listRecordedSessions("proj_a", 50)).map((s) => s.sessionId)).toEqual(["sess_a"]);
});

it("limit 으로 개수를 자른다", async () => {
  const store = open();
  for (let i = 0; i < 3; i += 1) {
    await store.saveSessionRecordingChunk({
      sessionId: `sess_${i}`,
      projectId: "proj_a",
      seq: 0,
      startedAt: "2026-09-15T00:00:00.000Z",
      receivedAt: `2026-09-15T0${i}:00:00.000Z`,
      eventCount: 1,
      bytes: new Uint8Array([1]),
    });
  }

  expect(await store.listRecordedSessions("proj_a", 2)).toHaveLength(2);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- src/store/store-contract.test.ts`
Expected: FAIL — `store.listRecordedSessions is not a function`

- [ ] **Step 3: 계약을 타입에 적는다**

`apps/api/src/store/types.ts`, `SessionRecordingChunk` 아래에 더한다.

```ts
/** 한 세션의 기록을 요약한 값. 목록 화면이 쓴다. */
export interface RecordedSessionSummary {
  sessionId: string;
  /** 가장 이른 청크의 `startedAt`. 브라우저 시계가 적은 값이라 표시용이다. */
  startedAt: string;
  /** 가장 늦은 청크의 `receivedAt`. 목록 정렬이 보는 값이다. */
  lastReceivedAt: string;
  chunkCount: number;
  eventCount: number;
  /** gzip 상태의 바이트 합. 푼 크기가 아니다. */
  bytes: number;
}
```

`TraceStore` 인터페이스의 `listSessionRecordingChunks` 바로 아래에 더한다.

```ts
  /** `lastReceivedAt` 내림차순. 최근 기록이 먼저다. */
  listRecordedSessions(projectId: string, limit: number): Promise<RecordedSessionSummary[]>;
```

- [ ] **Step 4: `MemoryStore` 에 구현한다**

`apps/api/src/store/memory-store.ts`, `listSessionRecordingChunks` 바로 아래.

```ts
  async listRecordedSessions(projectId: string, limit: number): Promise<RecordedSessionSummary[]> {
    const bySession = new Map<string, RecordedSessionSummary>();

    for (const chunk of this.sessionRecordings.values()) {
      if (chunk.projectId !== projectId) continue;

      const current = bySession.get(chunk.sessionId);
      if (!current) {
        bySession.set(chunk.sessionId, {
          sessionId: chunk.sessionId,
          startedAt: chunk.startedAt,
          lastReceivedAt: chunk.receivedAt,
          chunkCount: 1,
          eventCount: chunk.eventCount,
          bytes: chunk.bytes.byteLength,
        });
        continue;
      }

      current.startedAt = chunk.startedAt < current.startedAt ? chunk.startedAt : current.startedAt;
      current.lastReceivedAt =
        chunk.receivedAt > current.lastReceivedAt ? chunk.receivedAt : current.lastReceivedAt;
      current.chunkCount += 1;
      current.eventCount += chunk.eventCount;
      current.bytes += chunk.bytes.byteLength;
    }

    return Array.from(bySession.values())
      .sort((a, b) => (a.lastReceivedAt < b.lastReceivedAt ? 1 : -1))
      .slice(0, limit);
  }
```

`RecordedSessionSummary` 를 이 파일의 타입 import 에 더한다.

- [ ] **Step 5: `SqliteStore` 에 구현한다**

`apps/api/src/store/sqlite-store.ts`, `listSessionRecordingChunks` 바로 아래.

```ts
  async listRecordedSessions(projectId: string, limit: number): Promise<RecordedSessionSummary[]> {
    const rows = this.db
      .prepare(
        `SELECT session_id,
                MIN(started_at)     AS started_at,
                MAX(received_at)    AS last_received_at,
                COUNT(*)            AS chunk_count,
                SUM(event_count)    AS event_count,
                SUM(LENGTH(bytes))  AS bytes
           FROM session_recordings
          WHERE project_id = ?
          GROUP BY session_id
          ORDER BY last_received_at DESC
          LIMIT ?`,
      )
      .all(projectId, limit) as Row[];

    return rows.map((row) => ({
      sessionId: row.session_id as string,
      startedAt: row.started_at as string,
      lastReceivedAt: row.last_received_at as string,
      chunkCount: row.chunk_count as number,
      eventCount: row.event_count as number,
      bytes: row.bytes as number,
    }));
  }
```

`RecordedSessionSummary` 를 이 파일의 타입 import 에 더한다.

- [ ] **Step 6: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- src/store/store-contract.test.ts`
Expected: PASS — 두 구현 모두

- [ ] **Step 7: 커밋**

```bash
git add apps/api/src/store/types.ts apps/api/src/store/memory-store.ts apps/api/src/store/sqlite-store.ts apps/api/src/store/store-contract.test.ts
git commit -m "$(cat <<'EOF'
저장: 기록된 세션을 최근 순으로 집계한다

목록 화면이 세션 단위로 물어본다. 청크는 seq 단위로 쌓이므로 session_id 로
묶어 세는 계약을 스토어에 둔다. 정렬은 received_at 이다 - started_at 은
브라우저 시계가 적어 보낸 값이라 목록 순서를 맡길 수 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 매니페스트 라우트

**Files:**
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin-recording.test.ts` (생성)

**Interfaces:**
- Consumes: `listSessionRecordingChunks` (기존), `getProjectAccess`, `authenticate`
- Produces: `GET /admin/api/sessions/:sessionId/recording?projectId=...` → `{ chunks: Array<{ seq: number; eventCount: number; bytes: number; startedAt: string; receivedAt: string }> }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/routes/admin-recording.test.ts` 를 새로 만든다. 상단 설정은 `admin.test.ts` 의 `authConfig`·`signedInStore`·`createAuthenticatedOwner` 를 그대로 복사한다 — 그 파일이 이미 쓰는 방식이고, 테스트 파일 사이에 헬퍼를 공유하는 관례가 이 저장소에 없다.

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createAdminSessionForUser } from "../auth/session.js";
import type { AdminAuthConfig } from "../auth/config.js";
import { MemoryStore } from "../store/memory-store.js";

// (authConfig / signedInStore / createAuthenticatedOwner 는 admin.test.ts 에서 복사)

async function withRecording() {
  const fixture = await createAuthenticatedOwner();
  await fixture.store.saveSessionRecordingChunk({
    sessionId: "sess_abc",
    projectId: fixture.project.projectId,
    seq: 0,
    startedAt: "2026-09-15T00:00:00.000Z",
    receivedAt: "2026-09-15T00:00:10.000Z",
    eventCount: 3,
    bytes: new Uint8Array([31, 139, 8, 0, 1, 2, 3]),
  });
  return fixture;
}

describe("GET /admin/api/sessions/:sessionId/recording", () => {
  it("청크 매니페스트를 돌려준다", async () => {
    const { app, project, headers } = await withRecording();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      chunks: [
        {
          seq: 0,
          eventCount: 3,
          bytes: 7,
          startedAt: "2026-09-15T00:00:00.000Z",
          receivedAt: "2026-09-15T00:00:10.000Z",
        },
      ],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("기록이 없으면 404 가 아니라 빈 배열이다", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_none/recording?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ chunks: [] });
  });

  it("인증이 없으면 401", async () => {
    const { app, project } = await withRecording();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording?projectId=${project.projectId}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("멤버가 아니면 403 이고 감사 로그를 남긴다", async () => {
    const { app, store, project, headers } = await withRecording();
    const outsider = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_outsider",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: outsider });
    void headers;

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording?projectId=${project.projectId}`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(403);
    // listAuditLogs() 는 인자를 받지 않는다.
    const logs = await store.listAuditLogs();
    expect(logs.some((log) => log.action === "project.access_denied")).toBe(true);
  });

  it("조회자도 볼 수 있다", async () => {
    const { app, store, project, headers } = await withRecording();
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: viewer.adminUserId,
      role: "viewer",
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: viewer });
    void headers;

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording?projectId=${project.projectId}`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- src/routes/admin-recording.test.ts`
Expected: FAIL — 404 (라우트가 없다)

- [ ] **Step 3: 리소스 종류를 더한다**

`apps/api/src/routes/admin-proxy.ts` 의 `ProjectResourceType` 에 한 줄.

```ts
  | "session_timeline"
  | "session_recording";
```

- [ ] **Step 4: 라우트를 더한다**

`admin-proxy.ts` 의 세션 타임라인 라우트 바로 아래.

```ts
  app.get("/admin/api/sessions/:sessionId/recording", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { sessionId } = sessionParamsSchema.parse(request.params);
    const { projectId } = projectQuerySchema.parse(request.query);
    const access = await getProjectAccess(options.store, projectId, authenticated, "session_recording");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const chunks = await options.store.listSessionRecordingChunks(projectId, sessionId);

    // 기록이 없어도 404 가 아니다. 보존 기간이 지나 지워진 것과 트리거가 안
    // 걸린 것을 화면이 같은 빈 상태로 다룬다.
    return reply.header("cache-control", "no-store").send({
      chunks: chunks.map((chunk) => ({
        seq: chunk.seq,
        eventCount: chunk.eventCount,
        // gzip 상태의 크기다. 화면은 이것으로 진행률을 보여준다.
        bytes: chunk.bytes.byteLength,
        startedAt: chunk.startedAt,
        receivedAt: chunk.receivedAt,
      })),
    });
  });
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- src/routes/admin-recording.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin-recording.test.ts
git commit -m "$(cat <<'EOF'
관리자: 세션 기록의 청크 매니페스트를 연다

본문과 목록을 나눈다. 화면이 몇 개를 언제까지 받아야 하는지 먼저 알아야
첫 청크로 재생을 시작하고 나머지를 뒤에서 채울 수 있다.

기록이 없어도 404 를 주지 않는다. 보존 기간이 지나 지워진 것과 트리거가
안 걸린 것을 운영자가 구분해 봐야 할 일이 다르지 않다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 청크 라우트 — gzip 을 그대로

**Files:**
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin-recording.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `session_recording` 리소스 종류
- Produces: `GET /admin/api/sessions/:sessionId/recording/chunks/:seq?projectId=...` → gzip 바이트, `Content-Encoding: gzip`, `Content-Type: application/json`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`admin-recording.test.ts` 에 더한다. **바이트 무결성이 이 라우트의 전부다.**

```ts
import { gzipSync } from "node:zlib";

describe("GET /admin/api/sessions/:sessionId/recording/chunks/:seq", () => {
  async function withGzipChunk() {
    const fixture = await createAuthenticatedOwner();
    const body = gzipSync(
      Buffer.from(
        JSON.stringify({
          projectId: fixture.project.projectId,
          seq: 0,
          startedAt: "2026-09-15T00:00:00.000Z",
          url: "https://demo.example.com/",
          sdkVersion: "0.1.0",
          events: [{ type: 2, data: {}, timestamp: 1 }],
        }),
        "utf8",
      ),
    );
    await fixture.store.saveSessionRecordingChunk({
      sessionId: "sess_abc",
      projectId: fixture.project.projectId,
      seq: 0,
      startedAt: "2026-09-15T00:00:00.000Z",
      receivedAt: "2026-09-15T00:00:10.000Z",
      eventCount: 1,
      bytes: new Uint8Array(body),
    });
    return { ...fixture, body };
  }

  it("저장된 gzip 바이트를 그대로 돌려준다", async () => {
    const { app, project, headers, body } = await withGzipChunk();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/0?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    // 바이트가 하나도 달라지면 안 된다. 서버가 풀었다 다시 감으면 여기서 깨진다.
    expect(Buffer.compare(response.rawPayload, body)).toBe(0);
  });

  it("없는 seq 는 404", async () => {
    const { app, project, headers } = await withGzipChunk();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/9?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("seq 가 숫자가 아니면 400", async () => {
    const { app, project, headers } = await withGzipChunk();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/abc?projectId=${project.projectId}`,
      headers,
    });

    expect(response.statusCode).toBe(400);
  });

  it("인증이 없으면 401", async () => {
    const { app, project } = await withGzipChunk();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/0?projectId=${project.projectId}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("조회자도 받을 수 있다", async () => {
    const { app, store, project } = await withGzipChunk();
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer_chunk",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: viewer.adminUserId,
      role: "viewer",
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: viewer });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/sessions/sess_abc/recording/chunks/0?projectId=${project.projectId}`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- src/routes/admin-recording.test.ts`
Expected: FAIL — 404

- [ ] **Step 3: 파라미터 스키마를 더한다**

`admin-proxy.ts` 상단의 스키마들 옆.

```ts
const recordingChunkParamsSchema = z.object({
  sessionId: z.string(),
  seq: z.coerce.number().int().min(0),
});
```

- [ ] **Step 4: 라우트를 더한다**

Task 2 의 라우트 바로 아래.

```ts
  app.get("/admin/api/sessions/:sessionId/recording/chunks/:seq", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const params = recordingChunkParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_chunk_seq" });

    const { projectId } = projectQuerySchema.parse(request.query);
    const access = await getProjectAccess(options.store, projectId, authenticated, "session_recording");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const chunks = await options.store.listSessionRecordingChunks(projectId, params.data.sessionId);
    const chunk = chunks.find((candidate) => candidate.seq === params.data.seq);
    if (!chunk) return reply.code(404).send({ error: "recording_chunk_not_found" });

    // **풀지 않는다.** 저장된 gzip 을 그대로 흘려보내고 브라우저가 푼다.
    // 업로드에서 content-encoding 을 피한 이유(프록시가 풀면 받는 것이
    // gzip 인지 매번 달라진다)는 내려받기에 해당되지 않는다 - 프록시가
    // 풀든 말든 브라우저가 받는 것은 JSON 이다.
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-encoding", "gzip")
      .header("cache-control", "no-store")
      .send(Buffer.from(chunk.bytes));
  });
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- src/routes/admin-recording.test.ts`
Expected: PASS

바이트 비교가 실패하면 Fastify 가 응답을 다시 직렬화했다는 뜻이다. `send(Buffer)` 는 그대로 통과해야 한다 — `content-type` 을 `application/json` 으로 두면 Fastify 가 객체를 JSON 으로 만들려 들 수 있으니, Buffer 를 보내는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin-recording.test.ts
git commit -m "$(cat <<'EOF'
관리자: 기록 청크를 gzip 인 채로 내려준다

서버가 재생을 위해 압축을 풀지 않는다. 실측으로 청크는 gzip 29,013 B,
풀면 304,493 B 로 10.5배다. 매 재생마다 32 MB 상한까지 푸는 경로를 여는
것보다 바이트를 그대로 넘기는 쪽이 self-hosted 에 맞다.

Content-Encoding 을 붙이면 브라우저가 투명하게 풀어 response.json() 이
그대로 동작한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 기록된 세션 목록 라우트

**Files:**
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin-recording.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `listRecordedSessions`
- Produces: `GET /admin/api/projects/:projectId/recorded-sessions` → `{ sessions: RecordedSessionSummary[] }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("GET /admin/api/projects/:projectId/recorded-sessions", () => {
  it("기록된 세션을 최근 순으로 돌려준다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await store.saveSessionRecordingChunk({
      sessionId: "sess_abc",
      projectId: project.projectId,
      seq: 0,
      startedAt: "2026-09-15T00:00:00.000Z",
      receivedAt: "2026-09-15T00:00:10.000Z",
      eventCount: 3,
      bytes: new Uint8Array([1, 2, 3]),
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/recorded-sessions`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sessions: [
        {
          sessionId: "sess_abc",
          startedAt: "2026-09-15T00:00:00.000Z",
          lastReceivedAt: "2026-09-15T00:00:10.000Z",
          chunkCount: 1,
          eventCount: 3,
          bytes: 3,
        },
      ],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("기록이 없으면 빈 배열", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/recorded-sessions`,
      headers,
    });

    expect(response.json()).toEqual({ sessions: [] });
  });

  it("인증이 없으면 401", async () => {
    const { app, project } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/recorded-sessions`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("조회자도 목록을 볼 수 있다", async () => {
    const { app, store, project } = await createAuthenticatedOwner();
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer_list",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-09-15T00:00:00.000Z",
    });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: viewer.adminUserId,
      role: "viewer",
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    const session = await createAdminSessionForUser({ store, config: authConfig, user: viewer });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/recorded-sessions`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- src/routes/admin-recording.test.ts`
Expected: FAIL — 404

- [ ] **Step 3: 상한 상수와 라우트를 더한다**

`admin-proxy.ts` 상단 스키마 옆.

```ts
// 질의 파라미터를 받지 않는다. 기록은 트리거가 걸린 세션만 올라오므로
// 페이지네이션이 필요할 만큼 쌓이는 것을 본 뒤에 만든다.
const RECORDED_SESSION_LIMIT = 50;
```

`/admin/api/projects/:projectId/issues` 라우트 아래에 더한다.

```ts
  app.get("/admin/api/projects/:projectId/recorded-sessions", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "session_recording");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const sessions = await options.store.listRecordedSessions(projectId, RECORDED_SESSION_LIMIT);
    return reply.header("cache-control", "no-store").send({ sessions });
  });
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- src/routes/admin-recording.test.ts`
Expected: PASS

- [ ] **Step 5: API 전체를 돌린다**

Run: `npm test --workspace @trace/api`
Expected: PASS — 기존 테스트가 하나도 깨지지 않아야 한다

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin-recording.test.ts
git commit -m "$(cat <<'EOF'
관리자: 기록된 세션 목록을 연다

문제 상세의 영향 세션에 재생 버튼을 붙이지 않는다. 리플레이는 트리거가
걸린 세션만 올라와서 그 세션에 기록이 있다는 보장이 없고, 비활성 버튼을
자주 보게 된다. 올라온 기록 자체가 곧 막힌 세션 목록이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 조립 순수 모듈

**Files:**
- Create: `apps/admin/src/replay/assemble.ts`
- Test: `apps/admin/src/replay/assemble.test.ts`

**Interfaces:**
- Consumes: Task 3 의 청크 본문(A 의 봉투 모양)
- Produces: `assembleChunk(raw: unknown): AssembledChunk`, `type AssembledChunk = { ok: true; events: unknown[] } | { ok: false; reason: "unreadable" }`

`Replayer` 는 jsdom 에서 돌지 않는다. 조립을 순수 함수로 빼면 순서·중복·깨짐을 `Replayer` 없이 직접 테스트할 수 있다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin/src/replay/assemble.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { assembleChunk } from "./assemble.js";

describe("assembleChunk", () => {
  it("봉투에서 events 를 꺼낸다", () => {
    const result = assembleChunk({
      projectId: "proj_a",
      seq: 0,
      startedAt: "2026-09-15T00:00:00.000Z",
      url: "https://demo.example.com/",
      sdkVersion: "0.1.0",
      events: [{ type: 2 }, { type: 3 }],
    });

    expect(result).toEqual({ ok: true, events: [{ type: 2 }, { type: 3 }] });
  });

  it("events 가 배열이 아니면 읽지 못한 것으로 본다", () => {
    expect(assembleChunk({ events: "nope" })).toEqual({ ok: false, reason: "unreadable" });
  });

  it("객체가 아니면 읽지 못한 것으로 본다", () => {
    expect(assembleChunk(null)).toEqual({ ok: false, reason: "unreadable" });
    expect(assembleChunk("[]")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("빈 events 는 읽은 것이다 - 이벤트가 0개인 청크는 정상이 아니지만 깨진 것도 아니다", () => {
    expect(assembleChunk({ events: [] })).toEqual({ ok: true, events: [] });
  });

  // 이벤트 본문은 검증하지 않는다. 모양이 rrweb 버전에 묶여 있다(A 스펙 §5).
  it("이벤트 본문이 무엇이든 그대로 통과시킨다", () => {
    const weird = [{ 총: "알 수 없는 모양" }, 42, null];
    expect(assembleChunk({ events: weird })).toEqual({ ok: true, events: weird });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/admin -- src/replay/assemble.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 구현한다**

`apps/admin/src/replay/assemble.ts`

```ts
export type AssembledChunk =
  | { ok: true; events: unknown[] }
  | { ok: false; reason: "unreadable" };

/**
 * 청크 본문에서 rrweb 이벤트를 꺼낸다.
 *
 * 이벤트 **본문은 검증하지 않는다** — 모양이 rrweb 버전에 묶여 있어 계약으로
 * 고정하면 라이브러리를 올릴 수 없다. 배열인지만 본다.
 */
export function assembleChunk(raw: unknown): AssembledChunk {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "unreadable" };

  const events = (raw as { events?: unknown }).events;
  if (!Array.isArray(events)) return { ok: false, reason: "unreadable" };

  return { ok: true, events };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/admin -- src/replay/assemble.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/admin/src/replay/assemble.ts apps/admin/src/replay/assemble.test.ts
git commit -m "$(cat <<'EOF'
재생: 청크 조립을 순수 모듈로 분리한다

Replayer 는 jsdom 에서 돌지 않는다. 조립을 화면에서 떼어 두면 순서와
깨진 청크를 Replayer 없이 직접 테스트할 수 있다.

이벤트 본문은 검증하지 않는다 - 모양이 rrweb 버전에 묶여 있다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 관리자 API 클라이언트

**Files:**
- Modify: `apps/admin/src/api.ts`

**Interfaces:**
- Consumes: Task 2·3·4 의 라우트
- Produces:
  - `type RecordedSessionResponse = { sessionId: string; startedAt: string; lastReceivedAt: string; chunkCount: number; eventCount: number; bytes: number }`
  - `type RecordingChunkSummary = { seq: number; eventCount: number; bytes: number; startedAt: string; receivedAt: string }`
  - `getRecordedSessions(projectId: string): Promise<RecordedSessionResponse[]>`
  - `getRecordingManifest(projectId: string, sessionId: string): Promise<RecordingChunkSummary[]>`
  - `getRecordingChunk(projectId: string, sessionId: string, seq: number): Promise<unknown>`

- [ ] **Step 1: 타입과 함수를 더한다**

이 Task 는 얇은 전달 계층이라 단위 테스트를 따로 두지 않는다 — Task 7·8 의 화면 테스트가 이 함수들을 모킹해 쓰고, 실제 왕복은 Task 9 의 실측이 확인한다. 기존 `getSessionTimeline` 도 같은 이유로 단위 테스트가 없다.

`apps/admin/src/api.ts` 의 타입 선언부에 더한다.

```ts
export interface RecordedSessionResponse {
  sessionId: string;
  startedAt: string;
  lastReceivedAt: string;
  chunkCount: number;
  eventCount: number;
  bytes: number;
}

export interface RecordingChunkSummary {
  seq: number;
  eventCount: number;
  /** gzip 상태의 크기다. 푼 크기가 아니다. */
  bytes: number;
  startedAt: string;
  receivedAt: string;
}
```

`getSessionTimeline` 아래에 더한다.

```ts
export async function getRecordedSessions(projectId: string): Promise<RecordedSessionResponse[]> {
  const body = await getJson<{ sessions: RecordedSessionResponse[] }>(
    `/admin/api/projects/${projectId}/recorded-sessions`,
  );
  return body.sessions;
}

export async function getRecordingManifest(
  projectId: string,
  sessionId: string,
): Promise<RecordingChunkSummary[]> {
  const body = await getJson<{ chunks: RecordingChunkSummary[] }>(
    `/admin/api/sessions/${sessionId}/recording?projectId=${projectId}`,
  );
  return body.chunks;
}

// 응답은 Content-Encoding: gzip 이다. 브라우저가 투명하게 풀어 주므로
// 여기서 압축을 다룰 일이 없다 - 우리가 풀면 두 번 푸는 것이다.
export async function getRecordingChunk(
  projectId: string,
  sessionId: string,
  seq: number,
): Promise<unknown> {
  return getJson<unknown>(
    `/admin/api/sessions/${sessionId}/recording/chunks/${seq}?projectId=${projectId}`,
  );
}
```

- [ ] **Step 2: 타입을 확인한다**

Run: `npm run typecheck`
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add apps/admin/src/api.ts
git commit -m "$(cat <<'EOF'
관리자: 기록 조회 세 함수를 더한다

청크 응답은 Content-Encoding 이 gzip 이라 브라우저가 투명하게 푼다.
클라이언트가 압축을 다루지 않는다 - 다루면 두 번 푸는 것이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 기록된 세션 목록 화면

**Files:**
- Create: `apps/admin/src/components/RecordedSessionTable.tsx`
- Test: `apps/admin/src/components/RecordedSessionTable.test.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `apps/admin/src/pages/pages.css`

**Interfaces:**
- Consumes: Task 6 의 `RecordedSessionResponse`
- Produces: `<RecordedSessionTable sessions={...} onSelectSession={(sessionId: string) => void} />`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin/src/components/RecordedSessionTable.test.tsx`

```tsx
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordedSessionTable } from "./RecordedSessionTable.js";

expect.extend(matchers);
afterEach(cleanup);

const sessions = [
  {
    sessionId: "sess_abc",
    startedAt: "2026-09-15T00:00:00.000Z",
    lastReceivedAt: "2026-09-15T00:05:00.000Z",
    chunkCount: 2,
    eventCount: 120,
    bytes: 58_026,
  },
];

describe("RecordedSessionTable", () => {
  it("세션 한 줄을 그린다", () => {
    render(<RecordedSessionTable sessions={sessions} onSelectSession={() => undefined} />);

    expect(screen.getByText("sess_abc")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    // gzip 크기를 사람이 읽는 단위로 보여준다.
    expect(screen.getByText("56.7 KB")).toBeInTheDocument();
  });

  it("행의 버튼을 누르면 sessionId 를 넘긴다", () => {
    const onSelectSession = vi.fn();
    render(<RecordedSessionTable sessions={sessions} onSelectSession={onSelectSession} />);

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(onSelectSession).toHaveBeenCalledWith("sess_abc");
  });

  it("비어 있으면 왜 비었는지 알려준다", () => {
    render(<RecordedSessionTable sessions={[]} onSelectSession={() => undefined} />);

    expect(
      screen.getByText(/트리거가 걸린 세션만 올라오고 기본 7일 뒤 지워집니다/),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/admin -- src/components/RecordedSessionTable.test.tsx`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 구현한다**

`apps/admin/src/components/RecordedSessionTable.tsx`

```tsx
import type { RecordedSessionResponse } from "../api.js";
import { formatKoreanDateTime } from "../time.js";
import { Button } from "../ui/Button.js";
import { DataTable, type Column } from "../ui/DataTable.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function RecordedSessionTable({
  sessions,
  onSelectSession,
}: {
  sessions: RecordedSessionResponse[];
  onSelectSession: (sessionId: string) => void;
}) {
  const columns: Array<Column<RecordedSessionResponse>> = [
    { key: "sessionId", header: "세션", render: (row) => <code>{row.sessionId}</code> },
    {
      key: "startedAt",
      header: "시작 (KST)",
      render: (row) => formatKoreanDateTime(row.startedAt),
    },
    {
      key: "eventCount",
      header: "이벤트",
      align: "end",
      render: (row) => String(row.eventCount),
    },
    {
      key: "bytes",
      header: "크기",
      align: "end",
      // gzip 상태의 크기다. 재생할 때 브라우저가 푸는 양은 약 10배다.
      render: (row) => formatBytes(row.bytes),
    },
    {
      key: "actions",
      header: "",
      headerLabel: "재생",
      align: "end",
      render: (row) => <Button onClick={() => onSelectSession(row.sessionId)}>재생</Button>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={sessions}
      rowKey={(row) => row.sessionId}
      empty="기록된 세션이 없습니다. 리플레이는 트리거가 걸린 세션만 올라오고 기본 7일 뒤 지워집니다."
    />
  );
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/admin -- src/components/RecordedSessionTable.test.tsx`
Expected: PASS

- [ ] **Step 5: 대시보드에 카드를 붙이는 실패 테스트를 쓴다**

`apps/admin/src/pages/DashboardPage.test.tsx` 에 더한다. 이 파일에는 렌더 헬퍼가 없고 매 테스트가 `render(<DashboardPage ... />)` 를 직접 쓴다 — 같은 방식을 따른다. `summary`·`projects` 는 파일 상단의 기존 상수다.

```tsx
it("기록된 세션 카드를 그린다", () => {
  render(
    <DashboardPage
      summary={summary}
      issues={[]}
      userEmail="admin@example.com"
      projects={[projects[0]!]}
      projectId="proj_demo"
      onSelectProject={vi.fn()}
      onCreateProject={vi.fn()}
      onLogout={vi.fn()}
      onShowInstall={vi.fn()}
      onShowSettings={vi.fn()}
      recordedSessions={[
        {
          sessionId: "sess_abc",
          startedAt: "2026-09-15T00:00:00.000Z",
          lastReceivedAt: "2026-09-15T00:05:00.000Z",
          chunkCount: 1,
          eventCount: 12,
          bytes: 1024,
        },
      ]}
      onSelectSession={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: "기록된 세션" })).toBeInTheDocument();
  expect(screen.getByText("sess_abc")).toBeInTheDocument();
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm test --workspace @trace/admin -- src/pages/DashboardPage.test.tsx`
Expected: FAIL — "기록된 세션" 제목이 없다

- [ ] **Step 7: `DashboardPage` 에 카드를 더한다**

props 에 두 개를 더한다.

```tsx
  recordedSessions?: RecordedSessionResponse[];
  onSelectSession?: (sessionId: string) => void;
```

기본값은 `recordedSessions = []`, `onSelectSession = () => {}` 다 — 기존 호출부가 깨지지 않게 한다.

이슈 표 아래에 카드를 둔다.

```tsx
      <Card as="section" className="recorded-sessions-panel">
        <div className="panel-heading">
          <h2>기록된 세션</h2>
        </div>
        <RecordedSessionTable sessions={recordedSessions} onSelectSession={onSelectSession} />
      </Card>
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm test --workspace @trace/admin -- src/pages/DashboardPage.test.tsx`
Expected: PASS

- [ ] **Step 9: 스타일을 더한다**

`apps/admin/src/pages/pages.css`, `.members-panel` 근처에.

```css
.recorded-sessions-panel {
  margin-top: var(--space-5);
}
```

- [ ] **Step 10: 관리자 전체를 돌린다**

Run: `npm test --workspace @trace/admin`
Expected: PASS

- [ ] **Step 11: 커밋**

```bash
git add apps/admin/src/components/RecordedSessionTable.tsx apps/admin/src/components/RecordedSessionTable.test.tsx apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/DashboardPage.test.tsx apps/admin/src/pages/pages.css
git commit -m "$(cat <<'EOF'
관리자: 대시보드에 기록된 세션 목록을 둔다

크기는 gzip 상태로 보여준다. 재생할 때 브라우저가 푸는 양은 약 10배지만,
운영자가 보존과 용량을 가늠할 때 보는 것은 저장된 크기다.

빈 상태에 이유를 적는다 - 기록이 없는 것은 대개 고장이 아니라 트리거가
걸리지 않았거나 보존 기간이 지난 것이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 재생 화면

**Files:**
- Create: `apps/admin/src/replay/player.ts`
- Create: `apps/admin/src/pages/SessionReplayPage.tsx`
- Test: `apps/admin/src/pages/SessionReplayPage.test.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/pages/pages.css`
- Modify: `apps/admin/package.json`

**Interfaces:**
- Consumes: Task 5 의 `assembleChunk`, Task 6 의 `getRecordingManifest`·`getRecordingChunk`
- Produces:
  - `type ReplayPlayer = { addEvent(event: unknown): void; play(): void; pause(): void; destroy(): void }`
  - `createPlayer(mount: HTMLElement, firstEvents: unknown[]): ReplayPlayer`
  - `<SessionReplayPage projectId sessionId onBack onAuthExpired createPlayer? />`

`Replayer` 는 jsdom 에서 돌지 않는다. 화면은 `createPlayer` 를 **주입받고** 기본값으로 진짜를 쓴다 — 테스트는 가짜를 넘긴다.

- [ ] **Step 1: rrweb 을 관리자 의존성으로 더한다**

```bash
npm install rrweb@2.0.0-alpha.4 --workspace @trace/admin
```

**이 Task 에서는 `package-lock.json` 변경을 되돌리지 않는다.** 의도한 산출물이다.

- [ ] **Step 2: player 경계를 만든다**

`apps/admin/src/replay/player.ts`

```ts
import { Replayer } from "rrweb";

export interface ReplayPlayer {
  addEvent(event: unknown): void;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  destroy(): void;
}

/**
 * rrweb `Replayer` 를 감싸는 경계.
 *
 * `Replayer` 는 jsdom 에서 돌지 않으므로 화면은 이 함수를 주입받는다.
 * 테스트는 가짜를 넘기고, 실제 동작은 브라우저에서 확인한다(Task 9).
 */
export function createPlayer(mount: HTMLElement, firstEvents: unknown[]): ReplayPlayer {
  const replayer = new Replayer(firstEvents as never[], { root: mount });

  return {
    addEvent: (event) => replayer.addEvent(event as never),
    play: () => replayer.play(),
    pause: () => replayer.pause(),
    setSpeed: (speed) => replayer.setConfig({ speed }),
    destroy: () => replayer.destroy(),
  };
}
```

2.0.0-alpha.4 의 시그니처는 확인해 뒀다(`node_modules/rrweb/typings/replay/index.d.ts`).

```
constructor(events: Array<eventWithTime | string>, config?: Partial<playerConfig>)
addEvent(rawEvent: eventWithTime | string): void
play(timeOffset?: number): void
pause(timeOffset?: number): void
setConfig(config: Partial<playerConfig>): void
destroy(): void
```

`playerConfig` 에 `root: Element` 와 `speed: number` 가 있다(`typings/types.d.ts:96,98`). rrweb 의 `eventWithTime` 을 관리자 타입에 들이지 않는다 — 우리는 이벤트 본문을 모르는 채로 다루기로 했으므로 경계에서 `as never` 로 넘긴다.

- [ ] **Step 3: 실패하는 화면 테스트를 쓴다**

`apps/admin/src/pages/SessionReplayPage.test.tsx`

```tsx
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReplayPage } from "./SessionReplayPage.js";
import * as api from "../api.js";

vi.mock("../api.js");

expect.extend(matchers);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fakePlayer() {
  return {
    events: [] as unknown[],
    played: 0,
    addEvent(event: unknown) {
      this.events.push(event);
    },
    play() {
      this.played += 1;
    },
    pause() {},
    setSpeed() {},
    destroy() {},
  };
}

const manifest = [
  { seq: 0, eventCount: 1, bytes: 10, startedAt: "2026-09-15T00:00:00.000Z", receivedAt: "2026-09-15T00:00:01.000Z" },
  { seq: 1, eventCount: 1, bytes: 10, startedAt: "2026-09-15T00:00:00.000Z", receivedAt: "2026-09-15T00:00:02.000Z" },
];

describe("SessionReplayPage", () => {
  beforeEach(() => {
    vi.mocked(api.getRecordingManifest).mockResolvedValue(manifest);
    vi.mocked(api.getRecordingChunk).mockImplementation(async (_p, _s, seq) => ({
      events: [{ type: 2, seq }],
    }));
  });

  it("첫 청크가 도착하면 재생을 시작하고 나머지를 뒤에서 채운다", async () => {
    const player = fakePlayer();

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => player}
      />,
    );

    await waitFor(() => expect(player.played).toBe(1));
    await waitFor(() => expect(player.events).toEqual([{ type: 2, seq: 1 }]));
  });

  it("기록이 없으면 왜 없는지 알려준다", async () => {
    vi.mocked(api.getRecordingManifest).mockResolvedValue([]);

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_none"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(
      await screen.findByText(/트리거가 걸린 세션만 올라오고 기본 7일 뒤 지워집니다/),
    ).toBeInTheDocument();
  });

  it("청크 하나가 깨져도 거기까지 재생하고 알려준다", async () => {
    vi.mocked(api.getRecordingChunk).mockImplementation(async (_p, _s, seq) =>
      seq === 0 ? { events: [{ type: 2 }] } : { events: "깨짐" },
    );
    const player = fakePlayer();

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => player}
      />,
    );

    expect(await screen.findByText("이후 기록을 읽지 못했습니다.")).toBeInTheDocument();
    expect(player.played).toBe(1);
  });

  it("401 이면 세션이 끝난 것을 알린다", async () => {
    vi.mocked(api.getRecordingManifest).mockRejectedValue(new api.ApiError(401, "admin_auth_required"));
    const onAuthExpired = vi.fn();

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={onAuthExpired}
        createPlayer={() => fakePlayer()}
      />,
    );

    await waitFor(() => expect(onAuthExpired).toHaveBeenCalledTimes(1));
  });

  it("403 이면 접근할 수 없다고 말한다", async () => {
    vi.mocked(api.getRecordingManifest).mockRejectedValue(new api.ApiError(403, "project_access_denied"));

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(await screen.findByText("이 프로젝트에 접근할 수 없습니다.")).toBeInTheDocument();
  });

  it("원본 스타일시트를 불러온다는 것을 적는다", async () => {
    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(await screen.findByText(/원본 사이트의 스타일시트를 불러옵니다/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `npm test --workspace @trace/admin -- src/pages/SessionReplayPage.test.tsx`
Expected: FAIL — 모듈이 없다

- [ ] **Step 5: 화면을 구현한다**

`apps/admin/src/pages/SessionReplayPage.tsx`

```tsx
import { useEffect, useRef, useState } from "react";
import { ApiError, getRecordingChunk, getRecordingManifest } from "../api.js";
import { assembleChunk } from "../replay/assemble.js";
import { createPlayer as createRealPlayer, type ReplayPlayer } from "../replay/player.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

type LoadState = "loading" | "empty" | "playing" | "truncated" | "forbidden";

export function SessionReplayPage({
  projectId,
  sessionId,
  onBack,
  onAuthExpired,
  createPlayer = createRealPlayer,
}: {
  projectId: string;
  sessionId: string;
  onBack: () => void;
  /** 401 일 때 App 이 로그인 화면으로 돌린다. 화면이 스스로 라우팅하지 않는다. */
  onAuthExpired: () => void;
  createPlayer?: (mount: HTMLElement, firstEvents: unknown[]) => ReplayPlayer;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<ReplayPlayer | undefined>(undefined);
  const [state, setState] = useState<LoadState>("loading");
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let player: ReplayPlayer | undefined;

    const run = async () => {
      const manifest = await getRecordingManifest(projectId, sessionId);
      if (cancelled) return;
      if (manifest.length === 0) {
        setState("empty");
        return;
      }

      for (const chunk of manifest) {
        const raw = await getRecordingChunk(projectId, sessionId, chunk.seq);
        if (cancelled) return;

        const assembled = assembleChunk(raw);
        if (!assembled.ok) {
          // 전체를 버리지 않는다. 여기까지 받은 것은 볼 수 있다.
          setState(player ? "truncated" : "empty");
          return;
        }

        if (!player) {
          const mount = mountRef.current;
          if (!mount) return;
          player = createPlayer(mount, assembled.events);
          playerRef.current = player;
          player.play();
          setState("playing");
          continue;
        }

        for (const event of assembled.events) player.addEvent(event);
      }
    };

    void run().catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof ApiError && error.status === 401) {
        onAuthExpired();
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setState("forbidden");
        return;
      }
      // 그 밖의 실패는 읽지 못한 것과 같게 다룬다 - 화면이 할 수 있는 일이 같다.
      setState((current) => (current === "playing" ? "truncated" : "empty"));
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = undefined;
    };
  }, [projectId, sessionId, createPlayer, onAuthExpired]);

  const changeSpeed = (next: number) => {
    setSpeed(next);
    playerRef.current?.setSpeed(next);
  };

  return (
    <main className="app-shell replay-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>세션 재생</h1>
          <p className="replay-subtitle">{sessionId}</p>
        </div>
        <div className="header-actions">
          <Button onClick={onBack}>대시보드로 돌아가기</Button>
        </div>
      </header>

      <p className="replay-note" role="note">
        기록은 스타일을 링크로 두므로 재생기가 <strong>원본 사이트의 스타일시트를 불러옵니다.</strong>{" "}
        그 사이트가 떠 있지 않거나 주소가 바뀌었으면 재생 화면이 원본과 다르게 보입니다.
      </p>

      {state === "empty" ? (
        <p className="empty-state">
          이 세션에는 기록이 없습니다. 리플레이는 트리거가 걸린 세션만 올라오고 기본 7일 뒤
          지워집니다.
        </p>
      ) : null}

      {state === "truncated" ? <p className="replay-error">이후 기록을 읽지 못했습니다.</p> : null}

      {state === "forbidden" ? (
        <p className="replay-error">이 프로젝트에 접근할 수 없습니다.</p>
      ) : null}

      <Card className="replay-stage">
        <div className="replay-mount" ref={mountRef} />
        <div className="replay-controls">
          <Button onClick={() => playerRef.current?.play()}>재생</Button>
          <Button onClick={() => playerRef.current?.pause()}>일시정지</Button>
          {[1, 2, 4].map((option) => (
            <Button
              key={option}
              variant={speed === option ? "primary" : "secondary"}
              onClick={() => changeSpeed(option)}
            >
              {option}x
            </Button>
          ))}
        </div>
      </Card>
    </main>
  );
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npm test --workspace @trace/admin -- src/pages/SessionReplayPage.test.tsx`
Expected: PASS. 출력이 깨끗해야 한다 — React 경고가 뜨면 고친다.

- [ ] **Step 7: 스타일을 더한다**

`apps/admin/src/pages/pages.css`

```css
.replay-subtitle {
  margin-top: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.replay-note {
  margin-bottom: var(--space-5);
  border-left: 3px solid var(--status-warn);
  background: var(--surface-sunk);
  padding: 12px 14px;
  font-size: var(--text-sm);
  line-height: 1.6;
}

.replay-error {
  color: var(--status-serious);
  font-weight: 700;
}

.replay-stage {
  display: grid;
  gap: var(--space-5);
  padding: 18px;
}

.replay-mount {
  position: relative;
  min-height: 480px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--white);
}

.replay-controls {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
```

- [ ] **Step 8: `App` 에 상태를 더한다**

`apps/admin/src/App.tsx` 의 `AppState` 에 더한다.

```ts
  | {
      type: "replay";
      dashboardData: { summary: DashboardSummary; issues: Issue[] };
      projects: ProjectOption[];
      projectId: string;
      sessionId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
      settingsSessionId: number;
    }
```

재생 화면은 lazy 로 가져온다 — 차트와 같은 패턴이다. `App.tsx` 상단에.

```ts
const SessionReplayPage = lazy(() =>
  import("./pages/SessionReplayPage.js").then((module) => ({ default: module.SessionReplayPage })),
);
```

`ready` 상태의 `DashboardPage` 렌더에 두 prop 을 넘기고, `recordedSessions` 는 대시보드를 불러올 때 함께 받는다(`getRecordedSessions`). `onSelectSession` 은 `setState` 로 `type: "replay"` 로 전환한다.

`state.type === "replay"` 분기에서 렌더한다.

```tsx
  if (state.type === "replay") {
    return (
      <Suspense fallback={<p className="empty-state">재생기를 불러오는 중입니다.</p>}>
        <SessionReplayPage
          projectId={state.projectId}
          sessionId={state.sessionId}
          onBack={() => setState({ ...state, type: "ready", data: state.dashboardData })}
          onAuthExpired={() => setState({ type: "login" })}
        />
      </Suspense>
    );
  }
```

> `onBack` 이 되돌아가는 `ready` 상태의 정확한 필드 구성은 `App.tsx:46` 의 타입을 보고 맞춘다. `settings` 화면의 `onBack` 이 같은 일을 하고 있으니 그 코드를 따른다.

- [ ] **Step 9: 전체를 돌린다**

Run: `npm test && npm run typecheck && npm run build`
Expected: 전부 통과. `npm run build` 출력에 **재생 화면이 별도 청크로 잘렸는지 확인한다** — `SessionReplayPage-*.js` 가 보여야 한다. 안 보이면 lazy import 가 정적 import 에 가려진 것이다.

- [ ] **Step 10: 커밋**

```bash
git add apps/admin/src/replay/player.ts apps/admin/src/pages/SessionReplayPage.tsx apps/admin/src/pages/SessionReplayPage.test.tsx apps/admin/src/App.tsx apps/admin/src/pages/pages.css apps/admin/package.json package-lock.json
git commit -m "$(cat <<'EOF'
재생: 첫 청크가 도착하면 바로 재생을 시작한다

세션 전체를 기다리지 않는다. 청크는 각각 독립된 gzip 문서라 순서대로
받아 뒤에서 addEvent 로 채우면 된다.

Replayer 는 jsdom 에서 돌지 않아 화면이 createPlayer 를 주입받는다.
테스트는 가짜를 넘기고 실제 재생은 브라우저에서 확인한다.

청크 하나가 깨져도 전체를 버리지 않는다 - 거기까지 재생하고 말한다.

rrweb 은 lazy import 로 잘라 별도 청크로 뺀다. 재생을 열지 않는
운영자는 받지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: A+B 묶음 실측과 문서

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1~8 전부

A 스펙 §6 이 B 에 미뤄 둔 세 가지를 여기서 확인한다. **숫자가 맞아도 이것이 안 되면 의미가 없다 — 와이어프레임이 정확히 여기서 실패했다.**

- [ ] **Step 1: 서버 셋을 띄운다**

```bash
npm run dev:api     # 4000
npm run dev:admin   # 5173
npm run dev:demo    # 5174
```

- [ ] **Step 2: 기록을 만든다**

관리자에서 프로젝트를 만들고 허용 도메인에 `http://localhost:5174` 를 넣는다. 프로젝트 설정에서 **세션 리플레이 켜기**를 체크하고, 마스킹 셀렉터에 데모 사이트에서 이름이 뜨는 요소의 선택자를 넣고 저장한다.

데모 사이트를 열고 같은 자리를 세 번 빠르게 클릭한다(분노 클릭 트리거).

- [ ] **Step 3: 재생해서 세 가지를 확인한다**

대시보드의 **기록된 세션**에서 방금 세션을 재생하고, 아래를 눈으로 본다.

- [ ] **흐름으로 읽히는가** — 어느 화면에서 무엇을 눌렀는지 따라갈 수 있는가
- [ ] **CSS 가 붙는가** — 원본 스타일시트를 링크로 불러오는데 재생 화면이 원본처럼 보이는가
- [ ] **마스킹 후에도 이해되는가** — 가린 자리가 `***` 로 보이면서도 무슨 화면인지 알 수 있는가

셋 중 하나라도 안 되면 **여기서 멈추고 보고한다.** 이것이 A+B 를 묶어 검증하는 이유다.

- [ ] **Step 4: 크기를 잰다**

```bash
sqlite3 apps/api/trace.db \
  "select session_id, count(*), sum(event_count), sum(length(bytes)) from session_recordings group by session_id;"
```

`npm run build` 의 관리자 청크 크기도 적는다 — 재생 청크가 얼마나 되는지.

- [ ] **Step 5: README 를 고친다**

`README.md` 의 리플레이 문단, 설정 켜기 안내 바로 뒤에 더한다.

```markdown
올라온 기록은 대시보드의 `기록된 세션`에서 재생합니다. 기록은 스타일을 링크로 두므로 재생기가 원본 사이트의 스타일시트를 불러옵니다 — 그 사이트가 떠 있지 않거나 주소가 바뀌었으면 재생 화면이 원본과 다르게 보입니다.
```

- [ ] **Step 6: 전체 검증**

Run: `npm test && npm run typecheck && npm run build`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
문서: 재생 경로와 스타일시트 한계를 적는다

CSS 를 링크로 둔 대가가 재생 화면에서 처음 드러난다. 원본 사이트가
떠 있지 않으면 화면이 원본과 달라진다는 것을 설치 절에 적는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 완료 기준

- `npm test` 전부 통과, 출력에 경고가 없다
- `npm run typecheck`·`npm run build` 통과
- `npm run build` 출력에 `SessionReplayPage-*.js` 가 별도 청크로 보인다
- 청크 라우트 응답 바이트가 DB BLOB 와 **바이트 단위로 같다**
- 조회자 계정으로 목록·매니페스트·청크가 모두 200 이다
- Task 9 의 세 가지 눈 확인이 끝났다
