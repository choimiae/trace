# Project Audit Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 owner가 설정 화면에서 활동 이력 화면으로 들어가 자기 프로젝트의 audit log를 최신순으로 읽고, `더 보기`로 이어 볼 수 있게 한다.

**Architecture:** 조회는 Store의 새 프로젝트 스코프 메서드 하나로 내리고, 기존 `listAuditLogs()`는 손대지 않는다. 행위자 해석은 Admin BFF가 `getAdminUser`로 중복 제거해서 붙이고, action별 한국어 문장은 Admin UI의 순수 함수가 조립한다. 페이지네이션은 `(createdAt, auditLogId)` keyset 커서로 offset drift 없이 이어 붙인다.

**Tech Stack:** TypeScript, Fastify, Zod, better-sqlite3, React, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-08-31-project-audit-logs-design.md`

## Global Constraints

- 기본 커뮤니케이션, 사용자-facing copy, commit message는 한국어를 사용한다.
- 대상은 `projectId`가 있는 audit log 6종이다. `auth.login_success`, `auth.logout`, `auth.login_failure`는 제외한다.
- 활동 이력 조회는 `owner`만 할 수 있다.
- 조회 API이므로 CSRF는 요구하지 않는다.
- 기존 `TraceStore.listAuditLogs()`의 시그니처와 동작을 바꾸지 않는다.
- 기존 audit log 기록 경로를 바꾸지 않는다. 이번 작업은 읽기만 추가한다.
- `audit_logs` 테이블 컬럼은 바꾸지 않는다. 인덱스만 `CREATE INDEX IF NOT EXISTS`로 추가한다.
- 시각은 UTC로 표시하고 열 제목에 `(UTC)`를 명시한다. 시간대 변환을 하지 않는다.
- 모르는 action은 코드와 `metadata` JSON으로 fallback한다. 화면이 깨지지 않아야 한다.
- 응답에서 값이 없는 키는 넣지 않는다. `undefined`를 담고 직렬화 결과에 의존하지 않는다.
- 라우터나 전역 상태 라이브러리를 도입하지 않는다. 기존 `AppState` 분기 방식을 유지한다.

---

## File Structure

- `apps/api/src/db/schema.sqlite.ts`: `audit_logs` 프로젝트 조회용 인덱스를 추가한다.
- `apps/api/src/store/types.ts`: `TraceStore`에 `listProjectAuditLogs` 계약을 추가한다.
- `apps/api/src/store/memory-store.ts`: 필터·정렬·커서·limit을 array 연산으로 구현한다. `Map` 삽입 순서에 기대지 않는다.
- `apps/api/src/store/sqlite-store.ts`: 풀어 쓴 keyset 조건과 `ORDER BY ... DESC`로 구현한다.
- `apps/api/src/store/store-contract.test.ts`: 두 스토어 공통 계약으로 검증한다.
- `apps/api/src/routes/admin.ts`: 활동 이력 query schema를 추가한다.
- `apps/api/src/routes/admin-proxy.ts`: `GET /admin/api/projects/:projectId/audit-logs` route, `ProjectResourceType` 항목, 커서 파싱, 행위자 해석을 추가한다.
- `apps/api/src/routes/admin.test.ts`: 권한, 정렬, 커서, 행위자, 격리, 검증을 검증한다.
- `apps/admin/src/api.ts`: 활동 이력 타입과 client 함수를 추가한다.
- `apps/admin/src/pages/ProjectAuditLogPage.tsx`: 새 화면과 `describeAuditLogEntry` 순수 함수.
- `apps/admin/src/pages/ProjectAuditLogPage.test.tsx`: 문장 조립과 컴포넌트 렌더링을 검증한다.
- `apps/admin/src/pages/ProjectSettingsPage.tsx`: owner 전용 `활동 이력` 버튼을 추가한다.
- `apps/admin/src/pages/ProjectSettingsPage.test.tsx`: 버튼 노출과 handler 호출을 검증한다.
- `apps/admin/src/pages/pages.css`: 활동 이력 목록 스타일을 추가한다.
- `apps/admin/src/App.tsx`: `audit` 상태, 진입/더보기/뒤로가기 handler, `handleShowSettings` guard 확장.
- `apps/admin/src/App.test.tsx`: 상태 전이와 stale 응답 guard를 검증한다.

---

### Task 1: Store Project Audit Log Query

**Files:**
- Modify: `apps/api/src/db/schema.sqlite.ts`
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: existing `AuditLogRecord`, `TraceStore.createAuditLog`, `TraceStore.createProject`, `TraceStore.upsertAdminUserFromGoogle`.
- Produces:

```ts
listProjectAuditLogs(input: {
  projectId: string;
  limit: number;
  cursor?: { createdAt: string; auditLogId: string };
}): Promise<AuditLogRecord[]>;
```

- 계약: `projectId`가 일치하는 log만, `createdAt` 내림차순·동일하면 `auditLogId` 내림차순, `cursor`가 있으면 그 항목보다 엄격히 뒤에 오는 것만, 최대 `limit`건.

- [ ] **Step 1: Write the failing store contract tests**

`apps/api/src/store/store-contract.test.ts`의 `describeTraceStoreContract` 안, 기존 audit log 테스트 근처에 추가한다. 기존 `open()`과 `createAuditLog` 패턴을 그대로 쓴다.

커서 경계와 동일 `createdAt` 처리를 확인하려면 `createdAt`이 겹치는 데이터가 필요하다. `createAuditLog`는 `auditLogId`를 스토어가 생성하므로, 정렬을 확인할 때는 반환된 목록에서 id를 읽어 커서를 만든다.

```ts
it("프로젝트별 활동 이력만 최신순으로 반환한다", async () => {
  const store = open();
  const project = await store.createProject({ name: "Audit", allowedDomains: [] });
  const other = await store.createProject({ name: "Other", allowedDomains: [] });

  await store.createAuditLog({
    adminUserId: "admin_1",
    action: "project.created",
    projectId: project.projectId,
    createdAt: "2026-08-31T00:00:00.000Z",
    metadata: { name: "Audit" },
  });
  await store.createAuditLog({
    adminUserId: "admin_1",
    action: "project.member_added",
    projectId: project.projectId,
    createdAt: "2026-08-31T02:00:00.000Z",
    metadata: { email: "member@example.com", role: "viewer" },
  });
  await store.createAuditLog({
    adminUserId: "admin_1",
    action: "project.updated",
    projectId: other.projectId,
    createdAt: "2026-08-31T03:00:00.000Z",
    metadata: {},
  });
  // projectId 가 없는 auth log 는 제외되어야 한다.
  await store.createAuditLog({
    action: "auth.login_success",
    createdAt: "2026-08-31T04:00:00.000Z",
    metadata: {},
  });

  const entries = await store.listProjectAuditLogs({
    projectId: project.projectId,
    limit: 20,
  });

  expect(entries.map((entry) => entry.action)).toEqual([
    "project.member_added",
    "project.created",
  ]);
});
```

이어서 다음 이름과 단언으로 테스트를 추가한다.

```ts
it("createdAt 이 같으면 auditLogId 내림차순으로 반환한다", async () => {
  // 같은 createdAt "2026-08-31T00:00:00.000Z" 으로 log 3건을 만든다.
  // listProjectAuditLogs 결과의 auditLogId 배열이 내림차순 정렬과 같은지 확인한다.
  // [...ids].sort().reverse() 와 비교해서 스토어별 삽입 순서에 기대지 않는다.
});

it("limit 이 적용된다", async () => {
  // 서로 다른 createdAt 으로 log 3건을 만든다.
  // { limit: 2 } 가 최신 2건만 반환한다.
});

it("커서로 다음 페이지가 중복 없이 이어진다", async () => {
  // 서로 다른 createdAt 으로 log 5건을 만든다.
  // limit 2 로 첫 페이지를 읽고, 마지막 항목의 createdAt/auditLogId 로 커서를 만든다.
  // 두 번째 페이지를 읽어 첫 페이지와 합친다.
  // 합친 auditLogId 집합의 크기가 4 이고 중복이 없다.
  // 합친 순서가 createdAt 내림차순이다.
});

it("createdAt 이 겹치는 경계에서도 커서가 중복과 누락을 만들지 않는다", async () => {
  // 같은 createdAt 으로 4건을 만든다.
  // limit 2 로 페이지를 끝까지 넘겨 모든 항목을 모은다.
  // 모은 auditLogId 집합이 4건이고 중복이 없다.
});

it("마지막 항목을 가리키는 커서는 빈 배열을 반환한다", async () => {
  // log 2건을 만들고 전부 읽는다.
  // 마지막 항목으로 커서를 만들어 다시 조회한다.
  // 결과가 [] 이다.
});
```

- [ ] **Step 2: Run store tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: FAIL because `TraceStore`와 두 구현에 `listProjectAuditLogs`가 없다.

- [ ] **Step 3: Add the index to the SQLite schema**

`apps/api/src/db/schema.sqlite.ts` 끝의 `audit_logs` 테이블 정의 바로 다음에 추가한다. 기존 인덱스(`events_project_timestamp`, `issues_project_severity`)와 같은 명명·서식 규칙을 따른다.

```sql
CREATE INDEX IF NOT EXISTS audit_logs_project_created ON audit_logs (project_id, created_at DESC, audit_log_id DESC);
```

- [ ] **Step 4: Add the TraceStore signature**

`apps/api/src/store/types.ts`에서 `listAuditLogs()` 바로 다음에 추가한다. `listAuditLogs()`는 그대로 둔다.

```ts
  listProjectAuditLogs(input: {
    projectId: string;
    limit: number;
    cursor?: { createdAt: string; auditLogId: string };
  }): Promise<AuditLogRecord[]>;
```

- [ ] **Step 5: Implement MemoryStore query**

`apps/api/src/store/memory-store.ts`에서 `listAuditLogs()` 다음에 추가한다.

`auditLogs`는 `Map`이라 `listAuditLogs()`가 삽입 순서를 그대로 돌려준다. 새 메서드는 명시적으로 정렬해야 SQLite와 같은 계약이 된다. 삽입 순서에 기대면 두 스토어가 어긋난다.

```ts
  async listProjectAuditLogs(input: {
    projectId: string;
    limit: number;
    cursor?: { createdAt: string; auditLogId: string };
  }): Promise<AuditLogRecord[]> {
    const { cursor } = input;
    return [...this.auditLogs.values()]
      .filter((entry) => entry.projectId === input.projectId)
      .filter((entry) => {
        if (cursor === undefined) return true;
        if (entry.createdAt < cursor.createdAt) return true;
        return entry.createdAt === cursor.createdAt && entry.auditLogId < cursor.auditLogId;
      })
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? right.auditLogId.localeCompare(left.auditLogId)
          : right.createdAt.localeCompare(left.createdAt),
      )
      .slice(0, input.limit);
  }
```

- [ ] **Step 6: Implement SqliteStore query**

`apps/api/src/store/sqlite-store.ts`에서 `listAuditLogs()` 다음에 추가한다.

row value 비교(`(a, b) < (?, ?)`) 대신 풀어 쓴 조건을 쓴다. SQLite 버전에 의존하지 않는다.

`listAuditLogs()`가 이미 같은 row 변환을 하고 있으므로, 변환을 `toAuditLogRecord` private helper로 먼저 뽑고 기존 메서드도 그 helper를 쓰게 바꾼다. 이 추출만으로 기존 테스트는 계속 통과해야 한다.

```ts
  private toAuditLogRecord(row: Row): AuditLogRecord {
    return compact({
      auditLogId: row.audit_log_id as string,
      adminUserId: row.admin_user_id as string | null,
      action: row.action as string,
      projectId: row.project_id as string | null,
      createdAt: row.created_at as string,
      metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
    }) as AuditLogRecord;
  }

  async listProjectAuditLogs(input: {
    projectId: string;
    limit: number;
    cursor?: { createdAt: string; auditLogId: string };
  }): Promise<AuditLogRecord[]> {
    const { cursor } = input;
    const rows = cursor === undefined
      ? (this.db
          .prepare(
            `SELECT * FROM audit_logs
             WHERE project_id = ?
             ORDER BY created_at DESC, audit_log_id DESC
             LIMIT ?`,
          )
          .all(input.projectId, input.limit) as Row[])
      : (this.db
          .prepare(
            `SELECT * FROM audit_logs
             WHERE project_id = ?
               AND (created_at < ? OR (created_at = ? AND audit_log_id < ?))
             ORDER BY created_at DESC, audit_log_id DESC
             LIMIT ?`,
          )
          .all(
            input.projectId,
            cursor.createdAt,
            cursor.createdAt,
            cursor.auditLogId,
            input.limit,
          ) as Row[]);

    return rows.map((row) => this.toAuditLogRecord(row));
  }
```

`listAuditLogs()`는 `return rows.map((row) => this.toAuditLogRecord(row));` 형태로 줄인다.

- [ ] **Step 7: Run store tests and typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS for both stores.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/store apps/api/src/db
git commit -m "관리자: 프로젝트 활동 이력 스토어 계약 추가"
```

---

### Task 2: Admin API Audit Log Route

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: Task 1 `TraceStore.listProjectAuditLogs`, existing `getProjectAccess`, `getAdminUser`.
- Produces:
  - `GET /admin/api/projects/:projectId/audit-logs`
  - export `auditLogQuerySchema`
  - response shape:

```ts
type ProjectAuditLogActorResponse = {
  adminUserId: string;
  email?: string;
  name?: string;
};

type ProjectAuditLogEntryResponse = {
  auditLogId: string;
  action: string;
  createdAt: string;
  actor?: ProjectAuditLogActorResponse;
  metadata: Record<string, unknown>;
};

type ProjectAuditLogPageResponse = {
  entries: ProjectAuditLogEntryResponse[];
  nextCursor?: string;
};
```

- [ ] **Step 1: Write the failing API tests**

`apps/api/src/routes/admin.test.ts`에 기존 멤버 후보 검색 테스트 다음으로 추가한다. 기존 `signedInStore()`, `createApp`, cookie 패턴을 그대로 쓴다.

행위자 조회 중복 제거를 검증하려면 `getAdminUser` 호출을 세는 스토어가 필요하다. 파일 상단의 `SaveTimeDuplicateStore`, `LastOwnerStore`와 같은 방식으로 subclass를 추가한다.

```ts
class CountingAdminUserStore extends MemoryStore {
  getAdminUserCalls = 0;

  override async getAdminUser(adminUserId: string) {
    this.getAdminUserCalls += 1;
    return super.getAdminUser(adminUserId);
  }
}
```

다음 테스트를 추가한다.

```ts
it("lets an owner read project audit logs newest first", async () => {
  // signedInStore() owner 와 프로젝트, owner membership 을 만든다.
  // createAuditLog 로 서로 다른 createdAt 의 log 2건을 owner 이름으로 만든다.
  // GET /admin/api/projects/:projectId/audit-logs 를 호출한다.
  // 200 이고 entries 가 createdAt 내림차순이다.
  // 각 entry 의 actor 를 toEqual 로 { adminUserId, email: "admin@example.com" } 와 비교한다.
  // signedInStore() 사용자는 name 이 없으므로 actor.name 키가 없다는 것까지 이 단언이 확인한다.
  // 다음 페이지가 없으므로 응답에 nextCursor 키가 없다.
});

it("resolves the actor name when the admin user has one", async () => {
  // name 이 있는 admin user 를 만들고 그 사용자 이름으로 audit log 를 남긴다.
  // actor.name 이 채워진다.
});

it("omits the actor when the audit log has no admin user", async () => {
  // adminUserId 없이 createAuditLog 를 호출한다 (projectId 는 준다).
  // 해당 entry 에 actor 키가 없다.
});

it("returns only the adminUserId when the actor no longer exists", async () => {
  // 존재하지 않는 adminUserId "admin_missing" 으로 audit log 를 남긴다.
  // actor 가 { adminUserId: "admin_missing" } 이고 email 키가 없다.
});

it("paginates project audit logs with a cursor", async () => {
  // log 3건을 서로 다른 createdAt 으로 만든다.
  // ?limit=2 로 첫 페이지를 읽는다. entries 2건, nextCursor 존재.
  // nextCursor 를 encodeURIComponent 해서 두 번째 페이지를 읽는다.
  // entries 1건이고 nextCursor 키가 없다.
  // 두 페이지의 auditLogId 가 겹치지 않는다.
});

it("excludes audit logs without a project and from other projects", async () => {
  // 대상 프로젝트 log 1건, 다른 프로젝트 log 1건, projectId 없는 auth.login_success 1건을 만든다.
  // 응답 entries 가 1건이고 대상 프로젝트 log 만 담는다.
});

it("looks up each distinct actor only once per page", async () => {
  // CountingAdminUserStore 로 app 을 만든다.
  // 같은 owner 이름으로 audit log 3건을 남긴다.
  // 조회 후 store.getAdminUserCalls 가 1 이다.
});
```

거부 케이스는 body까지 단언한다.

```ts
expect(response.statusCode).toBe(403);
expect(response.json()).toEqual({ error: "project_role_forbidden" });
```

Cover:
- admin·viewer 요청자는 `403 project_role_forbidden` (`it.each(["admin", "viewer"] as const)`)
- 프로젝트 멤버가 아닌 요청자는 `403 project_access_denied`이고 audit log에 `resourceType: "project_audit_logs"`가 남는다
- 없는 프로젝트는 `404 project_not_found`
- 세션 쿠키 없이 호출하면 `401 admin_auth_required`
- `?limit=0`, `?limit=101`, `?limit=abc`는 `400 invalid_audit_log_query` (`it.each(["0", "101", "abc"])`)
- `?cursor=nope`, `?cursor=|audit_1`, `?cursor=2026-08-31T00:00:00.000Z|`는 `400 invalid_audit_log_query` (`it.each`)
- `?limit=1`은 200이고 entries가 1건이다

- [ ] **Step 2: Run API tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts
```

Expected: FAIL with 404 for the new endpoint.

- [ ] **Step 3: Add the query schema**

`apps/api/src/routes/admin.ts`에 추가한다. query string은 항상 문자열로 들어오므로 `coerce`로 숫자로 바꾼다.

```ts
export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
```

- [ ] **Step 4: Add the resource type**

`apps/api/src/routes/admin-proxy.ts`의 `ProjectResourceType` union에 항목을 추가한다.

```ts
  | "project_audit_logs"
```

- [ ] **Step 5: Add the response types and cursor helpers**

`apps/api/src/routes/admin-proxy.ts`의 `ProjectMemberCandidateResponse` 타입 근처에 추가한다.

```ts
type ProjectAuditLogActorResponse = {
  adminUserId: string;
  email?: string;
  name?: string;
};

type ProjectAuditLogEntryResponse = {
  auditLogId: string;
  action: string;
  createdAt: string;
  actor?: ProjectAuditLogActorResponse;
  metadata: Record<string, unknown>;
};
```

파일 하단 helper 영역에 커서 인코딩과 파싱을 추가한다.

`createdAt`은 ISO 8601이고 `auditLogId`는 `audit_` prefix와 nanoid로 이루어져 둘 다 `|`를 담지 않는다. 첫 `|`를 구분자로 쓴다.

```ts
function encodeAuditLogCursor(entry: { createdAt: string; auditLogId: string }): string {
  return `${entry.createdAt}|${entry.auditLogId}`;
}

function parseAuditLogCursor(
  cursor: string,
): { createdAt: string; auditLogId: string } | undefined {
  const separator = cursor.indexOf("|");
  if (separator <= 0 || separator === cursor.length - 1) return undefined;

  const createdAt = cursor.slice(0, separator);
  const auditLogId = cursor.slice(separator + 1);
  if (Number.isNaN(Date.parse(createdAt))) return undefined;

  return { createdAt, auditLogId };
}
```

- [ ] **Step 6: Add the route**

`apps/api/src/routes/admin-proxy.ts`에서 `GET .../member-candidates` 다음, `POST .../members` 앞에 추가한다. `auditLogQuerySchema`를 import에 더한다. 조회 API이므로 CSRF 검증은 넣지 않는다.

```ts
  app.get("/admin/api/projects/:projectId/audit-logs", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_audit_logs");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
    // 권한 검사를 schema 검증보다 먼저 둔다. owner 가 아닌 요청자에게
    // limit·cursor 검증 결과를 흘리지 않는다.
    if (access.membership.role !== "owner") {
      return reply.code(403).send({ error: "project_role_forbidden" });
    }

    const parsed = auditLogQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_audit_log_query" });

    const cursor = parsed.data.cursor === undefined
      ? undefined
      : parseAuditLogCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && cursor === undefined) {
      return reply.code(400).send({ error: "invalid_audit_log_query" });
    }

    // limit + 1 을 읽어 다음 페이지 존재를 별도 count 없이 판정한다.
    const rows = await options.store.listProjectAuditLogs({
      projectId,
      limit: parsed.data.limit + 1,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const page = rows.slice(0, parsed.data.limit);
    const hasMore = rows.length > parsed.data.limit;

    const actors = await resolveAuditLogActors(options.store, page);
    const entries = page.map((row) => {
      const entry: ProjectAuditLogEntryResponse = {
        auditLogId: row.auditLogId,
        action: row.action,
        createdAt: row.createdAt,
        metadata: row.metadata,
      };
      if (row.adminUserId !== undefined) {
        entry.actor = actors.get(row.adminUserId) ?? { adminUserId: row.adminUserId };
      }
      return entry;
    });

    const lastEntry = page[page.length - 1];
    return hasMore && lastEntry !== undefined
      ? { entries, nextCursor: encodeAuditLogCursor(lastEntry) }
      : { entries };
  });
```

- [ ] **Step 7: Add the actor resolver**

파일 하단 helper 영역에 추가한다. 한 페이지의 행위자는 보통 1-3명이므로 distinct한 `adminUserId`만 조회해 재사용한다.

```ts
async function resolveAuditLogActors(
  store: TraceStore,
  rows: Array<{ adminUserId?: string }>,
): Promise<Map<string, ProjectAuditLogActorResponse>> {
  const distinct = [...new Set(
    rows
      .map((row) => row.adminUserId)
      .filter((adminUserId): adminUserId is string => adminUserId !== undefined),
  )];

  const resolved = await Promise.all(
    distinct.map(async (adminUserId) => {
      const user = await store.getAdminUser(adminUserId);
      const actor: ProjectAuditLogActorResponse = { adminUserId };
      if (user !== undefined) {
        actor.email = user.email;
        if (user.name !== undefined) actor.name = user.name;
      }
      return [adminUserId, actor] as const;
    }),
  );

  return new Map(resolved);
}
```

- [ ] **Step 8: Run API tests and typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes
git commit -m "관리자: 프로젝트 활동 이력 조회 API 추가"
```

---

### Task 3: Audit Log Page and Sentence Rendering

**Files:**
- Modify: `apps/admin/src/api.ts`
- Create: `apps/admin/src/pages/ProjectAuditLogPage.tsx`
- Create: `apps/admin/src/pages/ProjectAuditLogPage.test.tsx`
- Modify: `apps/admin/src/pages/pages.css`

**Interfaces:**
- Consumes: Task 2 `GET /admin/api/projects/:projectId/audit-logs`, existing `Button`, `Card`.
- Produces:

```ts
// apps/admin/src/api.ts
export interface ProjectAuditLogActorResponse {
  adminUserId: string;
  email?: string;
  name?: string;
}

export interface ProjectAuditLogEntryResponse {
  auditLogId: string;
  action: string;
  createdAt: string;
  actor?: ProjectAuditLogActorResponse;
  metadata: Record<string, unknown>;
}

export interface ProjectAuditLogPageResponse {
  entries: ProjectAuditLogEntryResponse[];
  nextCursor?: string;
}

export async function getProjectAuditLogs(
  projectId: string,
  cursor?: string,
): Promise<ProjectAuditLogPageResponse>;

// apps/admin/src/pages/ProjectAuditLogPage.tsx
export function describeAuditLogEntry(entry: ProjectAuditLogEntryResponse): string;
export function describeAuditLogActor(entry: ProjectAuditLogEntryResponse): string;

export interface ProjectAuditLogPageProps {
  projectId: string;
  entries: ProjectAuditLogEntryResponse[];
  hasMore: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | undefined;
  onBack: () => void;
  onLoadMore: () => void;
}

export function ProjectAuditLogPage(props: ProjectAuditLogPageProps): JSX.Element;
```

- `action`은 `string`으로 둔다. union으로 좁히면 서버가 새 action을 추가할 때 클라이언트 타입이 먼저 깨진다.

- [ ] **Step 1: Write the failing sentence tests**

`apps/admin/src/pages/ProjectAuditLogPage.test.tsx`를 만든다. 기존 `ProjectSettingsPage.test.tsx`의 import·setup 형태를 따른다.

```tsx
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectAuditLogPage,
  describeAuditLogActor,
  describeAuditLogEntry,
} from "./ProjectAuditLogPage.js";

expect.extend(matchers);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function entry(overrides: Partial<React.ComponentProps<typeof ProjectAuditLogPage>["entries"][number]> = {}) {
  return {
    auditLogId: "audit_1",
    action: "project.created",
    createdAt: "2026-08-31T01:23:45.000Z",
    metadata: { name: "Demo" },
    ...overrides,
  };
}
```

문장 조립을 직접 검증한다.

```tsx
describe("describeAuditLogEntry", () => {
  it("프로젝트 생성을 설명한다", () => {
    expect(describeAuditLogEntry(entry({ action: "project.created", metadata: { name: "Demo" } })))
      .toBe("프로젝트 'Demo'을 만들었습니다.");
  });

  it("멤버 추가를 설명한다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.member_added",
      metadata: { email: "member@example.com", role: "viewer" },
    }))).toBe("member@example.com을 조회자로 추가했습니다.");
  });

  it("역할 변경을 설명한다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.member_role_updated",
      metadata: { email: "member@example.com", beforeRole: "viewer", afterRole: "admin" },
    }))).toBe("member@example.com의 역할을 조회자에서 관리자로 변경했습니다.");
  });

  it("멤버 제거를 설명한다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.member_removed",
      metadata: { email: "member@example.com", role: "admin" },
    }))).toBe("member@example.com(관리자)을 제거했습니다.");
  });

  it("접근 거부를 리소스 이름으로 설명한다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.access_denied",
      metadata: { resourceType: "project_members" },
    }))).toBe("멤버 목록 접근이 거부되었습니다.");
  });

  it("모르는 리소스는 코드를 그대로 보여준다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.access_denied",
      metadata: { resourceType: "future_resource" },
    }))).toBe("future_resource 접근이 거부되었습니다.");
  });
});
```

`project.updated`의 네 경우를 검증한다.

```tsx
describe("describeAuditLogEntry project.updated", () => {
  const updated = (before: unknown, after: unknown) =>
    describeAuditLogEntry(entry({ action: "project.updated", metadata: { before, after } }));

  it("이름 변경을 덧붙인다", () => {
    expect(updated(
      { name: "Old", allowedDomains: ["https://a.example.com"] },
      { name: "New", allowedDomains: ["https://a.example.com"] },
    )).toBe("프로젝트 설정을 변경했습니다. 이름을 'Old'에서 'New'로 바꿈");
  });

  it("도메인 개수 변경을 덧붙인다", () => {
    expect(updated(
      { name: "Same", allowedDomains: ["https://a.example.com"] },
      { name: "Same", allowedDomains: ["https://a.example.com", "https://b.example.com"] },
    )).toBe("프로젝트 설정을 변경했습니다. 허용 도메인 1개에서 2개로 변경");
  });

  it("개수가 같고 내용만 바뀌면 도메인 변경만 덧붙인다", () => {
    expect(updated(
      { name: "Same", allowedDomains: ["https://a.example.com"] },
      { name: "Same", allowedDomains: ["https://b.example.com"] },
    )).toBe("프로젝트 설정을 변경했습니다. 허용 도메인 변경");
  });

  it("이름과 도메인이 모두 그대로면 상세를 덧붙이지 않는다", () => {
    expect(updated(
      { name: "Same", allowedDomains: ["https://a.example.com"] },
      { name: "Same", allowedDomains: ["https://a.example.com"] },
    )).toBe("프로젝트 설정을 변경했습니다.");
  });

  it("이름과 도메인이 모두 바뀌면 둘 다 덧붙인다", () => {
    expect(updated(
      { name: "Old", allowedDomains: ["https://a.example.com"] },
      { name: "New", allowedDomains: [] },
    )).toBe("프로젝트 설정을 변경했습니다. 이름을 'Old'에서 'New'로 바꿈, 허용 도메인 1개에서 0개로 변경");
  });
});
```

fallback과 방어를 검증한다.

```tsx
describe("describeAuditLogEntry fallback", () => {
  it("모르는 action 은 코드와 metadata JSON 으로 보여준다", () => {
    expect(describeAuditLogEntry(entry({ action: "project.future_thing", metadata: { a: 1 } })))
      .toBe('project.future_thing {"a":1}');
  });

  it("metadata 에 기대한 키가 없어도 예외를 던지지 않는다", () => {
    expect(() => describeAuditLogEntry(entry({ action: "project.member_added", metadata: {} })))
      .not.toThrow();
    expect(() => describeAuditLogEntry(entry({ action: "project.updated", metadata: {} })))
      .not.toThrow();
    expect(() => describeAuditLogEntry(entry({ action: "project.created", metadata: {} })))
      .not.toThrow();
  });
});
```

행위자 4가지를 검증한다.

```tsx
describe("describeAuditLogActor", () => {
  it("이름과 이메일이 있으면 둘 다 보여준다", () => {
    expect(describeAuditLogActor(entry({
      actor: { adminUserId: "admin_1", email: "owner@example.com", name: "Owner" },
    }))).toBe("Owner · owner@example.com");
  });

  it("이메일만 있으면 이메일만 보여준다", () => {
    expect(describeAuditLogActor(entry({
      actor: { adminUserId: "admin_1", email: "owner@example.com" },
    }))).toBe("owner@example.com");
  });

  it("adminUserId 만 있으면 그것을 보여준다", () => {
    expect(describeAuditLogActor(entry({ actor: { adminUserId: "admin_gone" } })))
      .toBe("admin_gone");
  });

  it("actor 가 없으면 시스템으로 보여준다", () => {
    expect(describeAuditLogActor(entry())).toBe("시스템");
  });
});
```

- [ ] **Step 2: Write the failing component tests**

같은 파일에 추가한다.

```tsx
describe("ProjectAuditLogPage", () => {
  function renderPage(
    overrides: Partial<React.ComponentProps<typeof ProjectAuditLogPage>> = {},
  ) {
    return render(
      <ProjectAuditLogPage
        projectId="proj_demo"
        entries={[entry()]}
        hasMore={false}
        onBack={() => undefined}
        onLoadMore={() => undefined}
        {...overrides}
      />,
    );
  }

  it("시각을 UTC 로 표시하고 열 제목에 밝힌다", () => {
    renderPage();
    expect(screen.getByText("시각 (UTC)")).toBeInTheDocument();
    expect(screen.getByText("2026-08-31 01:23")).toBeInTheDocument();
  });

  it("행위자와 내용을 함께 보여준다", () => {
    renderPage({
      entries: [entry({ actor: { adminUserId: "admin_1", email: "owner@example.com", name: "Owner" } })],
    });
    expect(screen.getByText("Owner · owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("프로젝트 'Demo'을 만들었습니다.")).toBeInTheDocument();
  });

  it("hasMore 가 참일 때만 더 보기 버튼을 보여준다", () => {
    renderPage({ hasMore: false });
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
    cleanup();
    renderPage({ hasMore: true });
    expect(screen.getByRole("button", { name: "더 보기" })).toBeInTheDocument();
  });

  it("더 보기 클릭이 onLoadMore 를 호출한다", () => {
    const onLoadMore = vi.fn();
    renderPage({ hasMore: true, onLoadMore });
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("loadingMore 면 더 보기가 disabled 이고 불러오는 중을 보여준다", () => {
    renderPage({ hasMore: true, loadingMore: true });
    expect(screen.getByRole("button", { name: "불러오는 중" })).toBeDisabled();
  });

  it("첫 로드 중에는 불러오는 중만 보여주고 빈 목록 문구를 감춘다", () => {
    renderPage({ entries: [], loading: true });
    expect(screen.getByText("불러오는 중")).toBeInTheDocument();
    expect(screen.queryByText("활동 이력이 없습니다.")).not.toBeInTheDocument();
  });

  it("로드가 끝나고 이력이 없으면 안내를 보여준다", () => {
    renderPage({ entries: [] });
    expect(screen.getByText("활동 이력이 없습니다.")).toBeInTheDocument();
  });

  it("오류 문구를 보여준다", () => {
    renderPage({ error: "활동 이력을 불러오지 못했습니다." });
    expect(screen.getByText("활동 이력을 불러오지 못했습니다.")).toBeInTheDocument();
  });

  it("뒤로가기 클릭이 onBack 을 호출한다", () => {
    const onBack = vi.fn();
    renderPage({ onBack });
    fireEvent.click(screen.getByRole("button", { name: "설정으로 돌아가기" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run page tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectAuditLogPage.test.tsx
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Add the API client function**

`apps/admin/src/api.ts`에서 `addProjectMember` 앞에 추가한다. `cursor`는 불투명 문자열이므로 인코딩한다.

```ts
export interface ProjectAuditLogActorResponse {
  adminUserId: string;
  email?: string;
  name?: string;
}

export interface ProjectAuditLogEntryResponse {
  auditLogId: string;
  action: string;
  createdAt: string;
  actor?: ProjectAuditLogActorResponse;
  metadata: Record<string, unknown>;
}

export interface ProjectAuditLogPageResponse {
  entries: ProjectAuditLogEntryResponse[];
  nextCursor?: string;
}

export async function getProjectAuditLogs(
  projectId: string,
  cursor?: string,
): Promise<ProjectAuditLogPageResponse> {
  const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  return getJson<ProjectAuditLogPageResponse>(
    `/admin/api/projects/${projectId}/audit-logs${query}`,
  );
}
```

- [ ] **Step 5: Create the page module**

`apps/admin/src/pages/ProjectAuditLogPage.tsx`를 만든다. 헤더와 `Card` 사용은 `ProjectSettingsPage`의 형태를 따른다.

문장 조립부터 쓴다. `metadata`는 `Record<string, unknown>`이므로 좁히는 helper를 둔다.

```tsx
import type { ProjectAuditLogEntryResponse } from "../api.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

const RESOURCE_LABELS: Record<string, string> = {
  project_settings: "프로젝트 설정",
  project_members: "멤버 목록",
  project_member_candidates: "멤버 후보 검색",
  project_audit_logs: "활동 이력",
  project_summary: "대시보드 요약",
  project_issues: "문제 목록",
  issue_detail: "문제 상세",
  session_timeline: "세션 타임라인",
};

function readString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function readSettings(
  metadata: Record<string, unknown>,
  key: "before" | "after",
): { name?: string; allowedDomains?: unknown[] } | undefined {
  const value = metadata[key];
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : undefined;
  const allowedDomains = Array.isArray(record.allowedDomains) ? record.allowedDomains : undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(allowedDomains === undefined ? {} : { allowedDomains }),
  };
}

function roleLabel(role: string | undefined): string {
  if (role === "owner") return "소유자";
  if (role === "admin") return "관리자";
  if (role === "viewer") return "조회자";
  return role ?? "알 수 없는 역할";
}
```

`project.updated` 상세는 별도 함수로 뽑는다.

```tsx
function describeSettingsChange(metadata: Record<string, unknown>): string {
  const before = readSettings(metadata, "before");
  const after = readSettings(metadata, "after");
  if (before === undefined || after === undefined) return "";

  const details: string[] = [];
  if (before.name !== after.name) {
    details.push(`이름을 '${before.name ?? ""}'에서 '${after.name ?? ""}'로 바꿈`);
  }

  const beforeCount = before.allowedDomains?.length;
  const afterCount = after.allowedDomains?.length;
  if (beforeCount !== undefined && afterCount !== undefined) {
    if (beforeCount !== afterCount) {
      details.push(`허용 도메인 ${beforeCount}개에서 ${afterCount}개로 변경`);
    } else if (
      JSON.stringify(before.allowedDomains) !== JSON.stringify(after.allowedDomains)
    ) {
      details.push("허용 도메인 변경");
    }
  }

  return details.length === 0 ? "" : ` ${details.join(", ")}`;
}
```

문장 조립 본체를 쓴다.

```tsx
export function describeAuditLogEntry(entry: ProjectAuditLogEntryResponse): string {
  const { metadata } = entry;

  if (entry.action === "project.created") {
    return `프로젝트 '${readString(metadata, "name") ?? ""}'을 만들었습니다.`;
  }
  if (entry.action === "project.updated") {
    return `프로젝트 설정을 변경했습니다.${describeSettingsChange(metadata)}`;
  }
  if (entry.action === "project.member_added") {
    return `${readString(metadata, "email") ?? ""}을 ${roleLabel(readString(metadata, "role"))}로 추가했습니다.`;
  }
  if (entry.action === "project.member_role_updated") {
    const before = roleLabel(readString(metadata, "beforeRole"));
    const after = roleLabel(readString(metadata, "afterRole"));
    return `${readString(metadata, "email") ?? ""}의 역할을 ${before}에서 ${after}로 변경했습니다.`;
  }
  if (entry.action === "project.member_removed") {
    return `${readString(metadata, "email") ?? ""}(${roleLabel(readString(metadata, "role"))})을 제거했습니다.`;
  }
  if (entry.action === "project.access_denied") {
    const resourceType = readString(metadata, "resourceType") ?? "";
    return `${RESOURCE_LABELS[resourceType] ?? resourceType} 접근이 거부되었습니다.`;
  }

  // 서버가 새 action 을 추가해도 화면이 비어 보이지 않게 한다.
  return `${entry.action} ${JSON.stringify(metadata)}`;
}

export function describeAuditLogActor(entry: ProjectAuditLogEntryResponse): string {
  if (entry.actor === undefined) return "시스템";
  if (entry.actor.email === undefined) return entry.actor.adminUserId;
  return entry.actor.name === undefined
    ? entry.actor.email
    : `${entry.actor.name} · ${entry.actor.email}`;
}

function formatAuditLogTime(createdAt: string): string {
  // 시간대 변환을 하지 않는다. 열 제목에 (UTC) 를 명시한다.
  return createdAt.slice(0, 16).replace("T", " ");
}
```

컴포넌트를 쓴다.

```tsx
export interface ProjectAuditLogPageProps {
  projectId: string;
  entries: ProjectAuditLogEntryResponse[];
  hasMore: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | undefined;
  onBack: () => void;
  onLoadMore: () => void;
}

export function ProjectAuditLogPage({
  projectId,
  entries,
  hasMore,
  loading = false,
  loadingMore = false,
  error,
  onBack,
  onLoadMore,
}: ProjectAuditLogPageProps) {
  return (
    <main className="app-shell settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>활동 이력</h1>
          <p className="settings-subtitle">{projectId}</p>
        </div>
        <div className="header-actions">
          <Button onClick={onBack}>설정으로 돌아가기</Button>
        </div>
      </header>

      <Card as="section" className="settings-panel">
        <div className="audit-log-head">
          <span>시각 (UTC)</span>
          <span>행위자</span>
          <span>내용</span>
        </div>
        <div className="audit-log-list">
          {entries.map((entry) => (
            <div className="audit-log-row" key={entry.auditLogId}>
              <span className="audit-log-time">{formatAuditLogTime(entry.createdAt)}</span>
              <span className="audit-log-actor">{describeAuditLogActor(entry)}</span>
              <span className="audit-log-detail">{describeAuditLogEntry(entry)}</span>
            </div>
          ))}
        </div>
        {loading ? <p className="settings-subtitle">불러오는 중</p> : null}
        {!loading && entries.length === 0 ? (
          <p className="settings-subtitle">활동 이력이 없습니다.</p>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
        {hasMore ? (
          <div className="settings-actions">
            <Button disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "불러오는 중" : "더 보기"}
            </Button>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
```

`loading`과 `loadingMore`가 동시에 `불러오는 중` 텍스트를 만들 수 있다. 첫 로드에서는 `hasMore`가 거짓이므로 버튼이 없고, `더 보기` 중에는 `loading`이 거짓이므로 문단이 없다. 두 문구가 같이 나오지 않는다.

- [ ] **Step 6: Add audit log styles**

`apps/admin/src/pages/pages.css`의 후보 목록 스타일(`.member-candidate-selected`) 다음에 추가한다. `.member-row`와 같은 토큰을 쓴다.

```css
.audit-log-head,
.audit-log-row {
  display: grid;
  grid-template-columns: 132px 200px 1fr;
  gap: var(--space-4);
  align-items: start;
}

.audit-log-head {
  padding: 0 0 var(--space-3);
  border-bottom: 1px solid var(--border);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.audit-log-list {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-3);
}

.audit-log-row {
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.audit-log-list .audit-log-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.audit-log-time,
.audit-log-actor {
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.audit-log-actor,
.audit-log-detail {
  overflow-wrap: anywhere;
}

@media (max-width: 820px) {
  .audit-log-head {
    display: none;
  }

  .audit-log-row {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }
}
```

`--text-sm`, `--ink-muted`, `--border`, `--space-1`, `--space-3`, `--space-4`가 `apps/admin/src/styles/tokens.css`에 있는지 확인하고, 없는 토큰은 기존 `.member-row` 규칙이 쓰는 값으로 맞춘다.

- [ ] **Step 7: Run page tests and typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectAuditLogPage.test.tsx
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS. `npm run typecheck`는 아직 `App.tsx`를 건드리지 않았으므로 통과한다.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/api.ts apps/admin/src/pages/ProjectAuditLogPage.tsx apps/admin/src/pages/ProjectAuditLogPage.test.tsx apps/admin/src/pages/pages.css
git commit -m "관리자: 활동 이력 화면과 문장 렌더링 추가"
```

---

### Task 4: Settings Entry Button

**Files:**
- Modify: `apps/admin/src/pages/ProjectSettingsPage.tsx`
- Test: `apps/admin/src/pages/ProjectSettingsPage.test.tsx`

**Interfaces:**
- Consumes: existing `ProjectSettingsPage` props, `Button`.
- Produces: new optional prop

```ts
onShowAuditLog?: (() => void) | undefined;
```

- `project.role === "owner"`이고 이 prop이 있을 때만 `활동 이력` 버튼을 보여준다.

- [ ] **Step 1: Write the failing settings tests**

`apps/admin/src/pages/ProjectSettingsPage.test.tsx`에 추가한다. 기존 `renderRequiredProps` helper를 그대로 쓴다. 이 prop은 optional이므로 helper의 필수 props는 바꾸지 않는다.

```tsx
it("owner 에게 활동 이력 버튼을 보여주고 클릭을 전달한다", () => {
  const onShowAuditLog = vi.fn();
  renderRequiredProps({ onShowAuditLog });

  fireEvent.click(screen.getByRole("button", { name: "활동 이력" }));

  expect(onShowAuditLog).toHaveBeenCalledTimes(1);
});

it("handler 가 없으면 활동 이력 버튼을 보여주지 않는다", () => {
  renderRequiredProps();

  expect(screen.queryByRole("button", { name: "활동 이력" })).not.toBeInTheDocument();
});

it.each(["admin", "viewer"] as const)("%s 에게는 활동 이력 버튼을 보여주지 않는다", (role) => {
  renderRequiredProps({
    project: { ...ownerProject, role },
    onShowAuditLog: () => undefined,
  });

  expect(screen.queryByRole("button", { name: "활동 이력" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run settings tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx
```

Expected: FAIL because the button does not exist.

- [ ] **Step 3: Add the prop and button**

`apps/admin/src/pages/ProjectSettingsPage.tsx`의 props interface에 추가한다.

```ts
  onShowAuditLog?: (() => void) | undefined;
```

구조 분해에도 `onShowAuditLog`를 더한다.

멤버 패널의 `memberActionError` 표시 다음, owner 전용 추가 폼 앞에 버튼을 넣는다. 멤버 목록과 멤버 추가 사이가 시각적으로 구분되는 자리다.

```tsx
        {project.role === "owner" && onShowAuditLog ? (
          <div className="settings-actions">
            <Button onClick={onShowAuditLog}>활동 이력</Button>
          </div>
        ) : null}
```

- [ ] **Step 4: Run settings tests and typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/ProjectSettingsPage.tsx apps/admin/src/pages/ProjectSettingsPage.test.tsx
git commit -m "관리자: 설정 화면에 활동 이력 진입 버튼 추가"
```

---

### Task 5: App Audit State Integration

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Test: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 `getProjectAuditLogs`, `ProjectAuditLogEntryResponse`, `ProjectAuditLogPage`; Task 4 `onShowAuditLog`.
- Produces: new `AppState` member

```ts
| {
    type: "audit";
    project: ProjectSettingsResponse;
    dashboardData: { summary: DashboardSummary; issues: Issue[] };
    projects: ProjectOption[];
    projectId: string;
    userEmail: string;
    adminUserId: string;
    csrfToken: string;
    settingsSessionId: number;
    entries: ProjectAuditLogEntryResponse[];
    nextCursor?: string | undefined;
    auditRequestId: number;
    loading: boolean;
    loadingMore: boolean;
    error?: string | undefined;
  }
```

- [ ] **Step 1: Register the api mock**

`apps/admin/src/App.test.tsx`의 `vi.hoisted` 객체와 `vi.mock("./api", ...)` 목록에 각각 추가한다. 두 곳 모두 export를 하나하나 나열하는 형태이므로 빠뜨리면 호출 시점에 `undefined`가 된다.

```ts
  getProjectAuditLogs: vi.fn(),
```

공용 `beforeEach`에 기본값을 넣는다. 활동 이력을 다루지 않는 기존 테스트는 이 화면에 들어가지 않으므로 기본값만으로 충분하다.

```ts
  api.getProjectAuditLogs.mockResolvedValue({
    entries: [
      {
        auditLogId: "audit_1",
        action: "project.member_added",
        createdAt: "2026-08-31T01:23:45.000Z",
        actor: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
        metadata: { email: "member@example.com", role: "viewer" },
      },
    ],
  });
```

- [ ] **Step 2: Write the failing App tests**

`apps/admin/src/App.test.tsx`의 설정 관련 describe 안에 추가한다.

```tsx
it("설정 화면에서 활동 이력으로 진입해 목록을 보여준다", async () => {
  api.getAuthMe.mockResolvedValue({
    user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
    projects: [{ projectId: "proj_demo", role: "owner" }],
    csrfToken: "csrf_1",
  });

  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "프로젝트 설정" }));
  fireEvent.click(await screen.findByRole("button", { name: "활동 이력" }));

  expect(await screen.findByRole("heading", { name: "활동 이력" })).toBeInTheDocument();
  expect(api.getProjectAuditLogs).toHaveBeenCalledWith("proj_demo", undefined);
  expect(screen.getByText("member@example.com을 조회자로 추가했습니다.")).toBeInTheDocument();
});
```

이어서 다음 테스트를 추가한다.

```tsx
it("더 보기로 다음 페이지를 이어 붙인다", async () => {
  // 첫 응답에 nextCursor 를 포함하고, 두 번째 응답은 다른 auditLogId 를 준다.
  // 활동 이력에 진입한 뒤 "더 보기" 를 누른다.
  // getProjectAuditLogs 가 ("proj_demo", 그 커서) 로 호출된다.
  // 두 항목이 모두 화면에 남아 있다.
  // 두 번째 응답에 nextCursor 가 없으면 "더 보기" 버튼이 사라진다.
});

it("더 보기 실패 시 기존 목록을 유지하고 오류를 보여준다", async () => {
  // 첫 응답에 nextCursor 를 포함하고, 두 번째 호출을 ApiError(500) 로 reject 한다.
  // "더 보기" 를 누른다.
  // "활동 이력을 불러오지 못했습니다." 가 보인다.
  // 첫 페이지 항목이 그대로 남아 있다.
});

it("첫 로드 실패 시 오류 문구를 보여준다", async () => {
  // getProjectAuditLogs 를 ApiError(500) 로 reject 한다.
  // "활동 이력을 불러오지 못했습니다." 가 보인다.
  // 활동 이력 화면은 그대로 유지된다.
});

it("활동 이력 권한 오류 문구를 보여준다", async () => {
  // ApiError(403, "project_role_forbidden") 로 reject 한다.
  // "활동 이력을 볼 권한이 없습니다." 가 보인다.
});

it("활동 이력이 401 이면 로그인 화면으로 보낸다", async () => {
  // ApiError(401, "admin_auth_required") 로 reject 한다.
  // "Google로 로그인" 버튼이 보인다.
});

it("설정으로 돌아가면 설정 화면을 다시 로드하고 후보 검색이 다시 발동한다", async () => {
  // 활동 이력에 진입한 뒤 "설정으로 돌아가기" 를 누른다.
  // "프로젝트 설정" heading 이 보인다.
  // getProjectSettings 와 getProjectMembers 가 각각 2번 호출된다.
  // searchProjectMemberCandidates 가 2번 호출된다.
});

it("늦게 도착한 활동 이력 응답은 무시한다", async () => {
  // 첫 응답은 수동 resolve 가능한 deferred 로 두고 활동 이력에 진입한다.
  // 그 상태에서 "설정으로 돌아가기" 를 누른다.
  // 이후 deferred 를 resolve 한다.
  // 화면이 설정 화면으로 남아 있고 활동 이력 heading 이 없다.
});
```

- [ ] **Step 3: Run App tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: FAIL because the audit state and entry button wiring do not exist.

- [ ] **Step 4: Extend imports and AppState**

`apps/admin/src/App.tsx`의 import에 추가한다.

```ts
  getProjectAuditLogs,
```

```ts
  type ProjectAuditLogEntryResponse,
```

```ts
import { ProjectAuditLogPage } from "./pages/ProjectAuditLogPage.js";
```

`AppState`에 Task 5 Interfaces의 `audit` 멤버를 추가한다. `settings` 멤버 다음에 둔다.

- [ ] **Step 5: Add the audit error mapper**

기존 `describeApiError` 패턴을 따라 `describeMemberCandidateSearchError` 다음에 추가한다.

```ts
// 활동 이력 조회 라우트가 반환할 수 있는 오류 코드를 한국어 안내로 옮긴다.
// apps/api/src/routes/admin-proxy.ts 의 GET audit-logs 핸들러 기준.
// UI 는 owner 일 때만 진입하고 limit 을 보내지 않으므로 권한/조건 오류는 정상
// 흐름에서는 나오지 않는다. 권한이 도중에 바뀐 경우를 위해 지도에 남긴다.
// 401 admin_auth_required 는 login 화면으로 전이하므로 이 지도에 담지 않는다.
const PROJECT_AUDIT_LOG_ERROR_MESSAGES: Record<string, string> = {
  project_role_forbidden: "활동 이력을 볼 권한이 없습니다.",
  project_access_denied: "더 이상 이 프로젝트의 멤버가 아닙니다.",
  project_not_found: "프로젝트를 찾을 수 없습니다.",
  invalid_audit_log_query: "조회 조건이 올바르지 않습니다.",
};

function describeProjectAuditLogError(error: unknown): string {
  return describeApiError(
    PROJECT_AUDIT_LOG_ERROR_MESSAGES,
    error,
    "활동 이력을 불러오지 못했습니다.",
  );
}
```

- [ ] **Step 6: Widen the settings entry guard**

`handleShowSettings`는 현재 `state.type !== "ready"`면 즉시 반환하고, 응답 반영 시 `current.type === "ready"`를 요구한다. 활동 이력에서도 돌아올 수 있게 두 곳을 넓힌다.

함수 시작부를 바꾼다.

```ts
  const handleShowSettings = async () => {
    if (state.type !== "ready" && state.type !== "audit") return;
    const projectId = state.projectId;
```

`ready`에서만 의미가 있는 `settingsError` 초기화는 조건을 유지한다.

성공 반영 updater의 guard를 바꾼다.

```ts
      setState((current) =>
        (current.type === "ready" || current.type === "audit") && current.projectId === projectId
          ? {
              type: "settings",
              project,
              members,
              dashboardData: current.type === "ready" ? current.data : current.dashboardData,
              ...
```

실패 분기의 guard도 같이 넓히고, `dashboardData` 참조를 같은 방식으로 갈라 쓴다. `ready`는 `current.data`, `audit`은 `current.dashboardData`를 갖는다.

- [ ] **Step 7: Add the audit load runner**

`runMemberCandidateSearch` 다음에 추가한다. 진입 로드와 `더 보기`가 같은 guard를 쓰게 한다. request id는 호출자가 자기 render의 state에서 계산해 넘긴다.

```ts
  const runAuditLogLoad = (
    projectId: string,
    settingsSessionId: number,
    requestId: number,
    cursor: string | undefined,
  ) => {
    void getProjectAuditLogs(projectId, cursor)
      .then((page) => {
        setState((current) => {
          if (
            current.type !== "audit"
            || current.projectId !== projectId
            || current.settingsSessionId !== settingsSessionId
            || current.auditRequestId !== requestId
          ) return current;
          return Object.assign({}, current, {
            entries: cursor === undefined ? page.entries : current.entries.concat(page.entries),
            nextCursor: page.nextCursor,
            loading: false,
            loadingMore: false,
            error: undefined,
          });
        });
      })
      .catch((error: unknown) => {
        setState((current) => {
          if (error instanceof ApiError && error.status === 401) return { type: "login" };
          if (
            current.type !== "audit"
            || current.projectId !== projectId
            || current.settingsSessionId !== settingsSessionId
            || current.auditRequestId !== requestId
          ) return current;
          return Object.assign({}, current, {
            loading: false,
            loadingMore: false,
            error: describeProjectAuditLogError(error),
          });
        });
      });
  };
```

- [ ] **Step 8: Add the settings-side entry handler**

`state.type === "settings"` 분기 안, `handleSelectMemberCandidate` 다음에 추가한다.

```ts
    const handleShowAuditLog = () => {
      setState({
        type: "audit",
        project: state.project,
        dashboardData: state.dashboardData,
        projects: state.projects,
        projectId: state.projectId,
        userEmail: state.userEmail,
        adminUserId: state.adminUserId,
        csrfToken: state.csrfToken,
        settingsSessionId: state.settingsSessionId,
        entries: [],
        nextCursor: undefined,
        auditRequestId: 1,
        loading: true,
        loadingMore: false,
        error: undefined,
      });
      runAuditLogLoad(state.projectId, state.settingsSessionId, 1, undefined);
    };
```

`ProjectSettingsPage` 호출부에 prop을 넘긴다.

```tsx
        onShowAuditLog={handleShowAuditLog}
```

- [ ] **Step 9: Render the audit screen**

`state.type === "settings"` 분기 다음에 추가한다.

```tsx
  if (state.type === "audit") {
    const handleLoadMore = () => {
      if (state.nextCursor === undefined) return;
      const requestId = state.auditRequestId + 1;
      const cursor = state.nextCursor;
      setState((current) =>
        current.type === "audit"
        && current.projectId === state.projectId
        && current.settingsSessionId === state.settingsSessionId
          ? Object.assign({}, current, {
              auditRequestId: requestId,
              loadingMore: true,
              error: undefined,
            })
          : current,
      );
      runAuditLogLoad(state.projectId, state.settingsSessionId, requestId, cursor);
    };

    return (
      <ProjectAuditLogPage
        projectId={state.projectId}
        entries={state.entries}
        hasMore={state.nextCursor !== undefined}
        loading={state.loading}
        loadingMore={state.loadingMore}
        error={state.error}
        onLoadMore={handleLoadMore}
        onBack={() => { void handleShowSettings(); }}
      />
    );
  }
```

`handleShowSettings`는 `state.type === "settings"` 분기보다 앞에 선언되어 있으므로 이 분기에서도 쓸 수 있다. 선언 위치를 확인하고, 뒤에 있으면 `audit` 분기를 그 뒤로 옮긴다.

- [ ] **Step 10: Run the full admin suite and typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS. `App.loading.test.tsx`가 깨지면 그 파일의 `vi.mock` 목록에도 `getProjectAuditLogs`를 등록해야 하는지 확인한다.

- [ ] **Step 11: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "관리자: 활동 이력 화면 상태 연결"
```

---

### Task 6: Final Verification and Branch Finish

**Files:** none by default.

- [ ] **Step 1: Review the whole diff against the spec**

```bash
git diff main --stat
```

확인 항목:
- `projectId`가 있는 6종만 조회된다. `auth.*`는 섞이지 않는다.
- owner만 진입할 수 있다.
- 행위자 4가지 경우가 각각 알맞게 표시된다.
- 6종 action이 한국어 문장으로 읽히고 모르는 action도 화면을 깨지 않는다.
- `더 보기`가 중복 없이 이어진다.
- `listAuditLogs()` 시그니처와 동작이 그대로다.
- `audit_logs` 컬럼 변경이 없고 인덱스만 추가됐다.

```bash
git diff main -- apps/api/src/db/schema.sqlite.ts
git diff main -- apps/api/src/store/types.ts
```

- [ ] **Step 2: Run typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test
```

Expected: PASS.

- [ ] **Step 4: Check whitespace and status**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; clean status.

- [ ] **Step 5: Commit final fixes if any**

Step 1 through Step 4에서 작은 수정이 필요했다면 해당 파일만 커밋한다.

```bash
git status --short
git commit -m "관리자: 활동 이력 조회 검증 보완"
```

- [ ] **Step 6: Finish branch**

After all tests pass and the working tree is clean, use `superpowers:finishing-a-development-branch` to decide whether to merge this branch into `main`, keep it for review, or hand off the final branch state.
