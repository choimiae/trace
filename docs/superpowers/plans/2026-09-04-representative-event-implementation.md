# 대표 이벤트 요소 단위 선택 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈가 자기 요소의 클릭만 대표 화면으로 쓰게 만들어, 형제 버튼의 화면을 근거로 보여주는 결함을 없앤다.

**Architecture:** 탐지기가 이미 만드는 요소 키(`elementKey()`)를 `Issue` 계약과 `issues` 테이블에 싣는다. 조회 시점에 SQL 로 정확히 거르기 위해 `events` 테이블에도 같은 키를 저장한다. 요소 키가 있는 이슈(`rage_click` · `dead_click_cluster`)는 그 키로 후보를 좁히고 30초 lead-in 없이 이슈 자신의 시간 구간만 본다. 요소 키가 없는 이슈(`long_pause` · `error_friction`)는 현재 동작을 그대로 유지한다.

**Tech Stack:** TypeScript(ESM, NodeNext) · zod · better-sqlite3 · Fastify · vitest

**Spec:** `docs/superpowers/specs/2026-09-04-representative-event-design.md`

## Global Constraints

- Node `>=22.5.0`. 모든 명령 앞에 `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH` 를 붙인다.
- 커밋 메시지는 한국어. `AGENTS.md` 의 프로젝트 규약이다.
- 임포트는 확장자 `.js` 를 붙인 ESM 경로다 (`./element-identity.js`). 확장자를 빼면 런타임에 깨진다.
- 요소 키의 폭은 **정확히 16 hex**. `hash64Hex` 출력이 항상 그 폭이다.
- `TraceEvent` **계약은 바뀌지 않는다.** `events.element_key` 는 조회용 저장 컬럼일 뿐이라 `toEvent` 가 매핑하지 않는다. 오직 `Issue` 계약만 필드를 얻는다.
- `apps/api/src/db/schema.sql` 은 **건드리지 않는다.** 어떤 코드도 읽지 않는 PostgreSQL 참고용 파일이고 이미 `screen_context` · `related_error_signature` 가 빠진 채 낡아 있다. 실제로 적재되는 스키마는 `apps/api/src/db/schema.sqlite.ts` 의 `SQLITE_SCHEMA` 뿐이다(`sqlite-store.ts:53`).
- 기준선: 623 테스트 통과. 각 태스크 끝에서 깨지지 않아야 한다.
- 시드 데이터로 최종 검증하지 않는다. 이 결함이 오래 안 걸린 이유가 손으로 해시를 다르게 넣은 시드였다.

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `packages/shared/src/events.ts` | 계약 | `issueSchema` 에 `elementKey` 추가 |
| `packages/shared/src/events.test.ts` | 계약 테스트 | 폭 검증 |
| `apps/api/src/detection/detect.ts` | 이슈 생성 | `makeIssue` 반환에 `elementKey` 싣기 |
| `apps/api/src/detection/detect.test.ts` | 탐지기 테스트 | 유형별 유무 + id 와 필드 일치 |
| `apps/api/src/db/schema.sqlite.ts` | 신규 DB 스키마 | 두 테이블에 `element_key` 컬럼 |
| `apps/api/src/store/sqlite-store.ts` | SQLite 구현 | 마이그레이션 · INSERT arity · `toIssue` · 조회 필터 |
| `apps/api/src/store/memory-store.ts` | 메모리 구현 | 조회 필터 |
| `apps/api/src/store/types.ts` | 스토어 인터페이스 | `ScreenContextEventQuery.elementKey` |
| `apps/api/src/store/store-contract.test.ts` | 두 스토어 공통 계약 테스트 | 요소 필터 검사 |
| `apps/api/src/store/sqlite-store.test.ts` | SQLite 전용 테스트 | 마이그레이션 검사 |
| `apps/api/src/routes/admin-proxy.ts` | 대표 이벤트 선택 | 키 유무로 갈리는 조회 |
| `apps/api/src/routes/admin.test.ts` | 조회부 테스트 | 요소 격리 · lead-in 제거 · 기존 동작 유지 |

## Task 순서와 이유

Task 1(계약) → 2(탐지기) → 3(저장) → 4(조회) → 5(조회부) → 6(실수집 검증).

계약이 먼저여야 뒤 태스크가 타입 오류 없이 컴파일된다. 저장이 조회보다 먼저여야 조회 테스트가 쓸 데이터를 만들 수 있다.

---

### Task 1: `Issue` 계약에 요소 키를 더한다

**Files:**
- Modify: `packages/shared/src/events.ts:290` (`issueSchema` 의 `status` 바로 위)
- Test: `packages/shared/src/events.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `Issue["elementKey"]` — `string | undefined`. Task 2·3·5 가 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/events.test.ts` 끝에 추가:

```ts
describe("issueSchema elementKey", () => {
  const baseIssue = {
    issueId: "issue__settings|abc|rage_click",
    projectId: "proj_1",
    issueType: "rage_click" as const,
    title: "제목",
    summary: "요약",
    affectedSessionsCount: 1,
    affectedUsersCount: 1,
    severityScore: 70,
    firstSeenAt: "2026-09-04T00:00:00.000Z",
    lastSeenAt: "2026-09-04T00:00:01.000Z",
    trend: "flat" as const,
    exampleSessionIds: [],
    status: "new" as const,
  };

  it("정확히 16 hex 를 받는다", () => {
    const parsed = issueSchema.parse({ ...baseIssue, elementKey: "0fd2102e520470ad" });
    expect(parsed.elementKey).toBe("0fd2102e520470ad");
  });

  it("없어도 된다 — 요소를 모르는 이슈가 있다", () => {
    expect(issueSchema.parse(baseIssue).elementKey).toBeUndefined();
  });

  // 폭이 짧은 값은 정상 값이 아니라 결함이다. elementKey() 는 hash64Hex 를 쓰므로
  // 항상 16 이고, 8 hex 가 들어왔다면 32비트 시절 지문이 새어 들어온 것이다.
  it("16 이 아닌 폭을 거절한다", () => {
    expect(() => issueSchema.parse({ ...baseIssue, elementKey: "0fd2102e" })).toThrow();
    expect(() => issueSchema.parse({ ...baseIssue, elementKey: "0fd2102e520470ad0" })).toThrow();
  });

  it("hex 가 아닌 글자를 거절한다", () => {
    expect(() => issueSchema.parse({ ...baseIssue, elementKey: "0fd2102e520470zz" })).toThrow();
  });
});
```

`issueSchema` 가 이 파일에 임포트돼 있지 않으면 상단 임포트에 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run packages/shared/src/events.test.ts -t elementKey`

Expected: FAIL — `elementKey` 가 스키마에 없어 `parsed.elementKey` 가 `undefined` 이고, 잘못된 폭도 통과한다.

- [ ] **Step 3: 계약에 필드를 더한다**

`packages/shared/src/events.ts` 의 `issueSchema` 에서 `status: issueStatusSchema,` 바로 위에 넣는다:

```ts
  // 요소 키는 hash64Hex 출력이라 항상 정확히 16 hex 다. privacy.ts 의
  // ELEMENT_SELECTOR_HASH_PATTERN(1~16)을 재사용하지 않는다 — 그 폭은 32비트
  // 시절의 8 hex 지문을 받아 주려고 열어 둔 것이고 요소 키에는 해당하지 않는다.
  elementKey: z.string().regex(/^[0-9a-f]{16}$/).optional(),
```

- [ ] **Step 4: 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run packages/shared/src/events.test.ts -t elementKey`

Expected: PASS (4 tests)

- [ ] **Step 5: shared 를 빌드하고 전체를 돌린다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build --workspace @trace/shared`
Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`

Expected: 둘 다 PASS. `@trace/api` 와 `@trace/admin` 은 `dist` 를 보므로 빌드가 먼저다.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared/src/events.ts packages/shared/src/events.test.ts
git commit -m "기능: 이슈 계약에 요소 키를 더한다"
```

---

### Task 2: 탐지기가 요소 키를 이슈에 싣는다

**Files:**
- Modify: `apps/api/src/detection/detect.ts:150-174` (`makeIssue` 의 반환 객체)
- Test: `apps/api/src/detection/detect.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `Issue["elementKey"]`
- Produces: `rage_click` · `dead_click_cluster` 이슈가 `elementKey` 를 실은 채 나온다. Task 5 가 이 값으로 조회한다.

`makeIssue` 는 이미 `elementKey?: string | undefined` 를 입력으로 받아 이슈 id 를 만드는 데 쓴다(`detect.ts:151-155`). 호출부 네 곳은 이미 `elementKey: elementKey(event)` 를 넘기므로 **변경이 없다.** 반환 객체에 싣기만 하면 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/detection/detect.test.ts` 끝에 추가. 파일 상단의 기존 이벤트 만들기 헬퍼를 쓰지 말고 자족적으로 쓴다:

```ts
describe("이슈가 요소 키를 싣는다", () => {
  const click = (eventId: string, timestamp: string, hash: string, text: string): TraceEvent => ({
    eventId,
    sessionId: "sess_1",
    pageId: "page_1",
    timestamp,
    type: "click",
    urlPath: "/settings",
    elementSelectorHash: hash,
    elementTextMaskedOrLimited: text,
    metadata: {},
  });

  it("반복 클릭 이슈에 그 요소의 키가 실린다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      events: [
        click("evt_1", "2026-09-04T00:00:00.000Z", "aaaaaaaaaaaaaaaa", "권한 추가"),
        click("evt_2", "2026-09-04T00:00:00.500Z", "aaaaaaaaaaaaaaaa", "권한 추가"),
        click("evt_3", "2026-09-04T00:00:01.000Z", "aaaaaaaaaaaaaaaa", "권한 추가"),
      ],
      now: "2026-09-04T00:01:00.000Z",
    });

    const rage = issues.find((issue) => issue.issueType === "rage_click");
    expect(rage?.elementKey).toBe(elementKey(click("x", "2026-09-04T00:00:00.000Z", "aaaaaaaaaaaaaaaa", "권한 추가")));
    expect(rage?.elementKey).toMatch(/^[0-9a-f]{16}$/);
  });

  // 이슈 id 와 필드가 각각 계산되므로, 둘이 갈라지면 조회가 조용히 빗나간다.
  // 같은 값이라는 것을 못박아 두 경로가 따로 놀지 못하게 한다.
  it("이슈 id 안의 키와 필드 값이 같다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      events: [
        click("evt_1", "2026-09-04T00:00:00.000Z", "bbbbbbbbbbbbbbbb", "저장"),
        click("evt_2", "2026-09-04T00:00:00.500Z", "bbbbbbbbbbbbbbbb", "저장"),
        click("evt_3", "2026-09-04T00:00:01.000Z", "bbbbbbbbbbbbbbbb", "저장"),
      ],
      now: "2026-09-04T00:01:00.000Z",
    });

    for (const issue of issues) {
      if (issue.elementKey === undefined) continue;
      expect(issue.issueId).toContain(`|${issue.elementKey}|`);
    }
  });

  it("요소 메타데이터가 없는 오류 이슈에는 키가 없다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      events: [
        {
          eventId: "evt_err",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-04T00:00:00.000Z",
          type: "js_error",
          urlPath: "/settings",
          metadata: {},
        },
      ],
      now: "2026-09-04T00:01:00.000Z",
    });

    const error = issues.find((issue) => issue.issueType === "error_friction");
    expect(error).toBeDefined();
    expect(error?.elementKey).toBeUndefined();
  });
});
```

상단 임포트에 `elementKey` 와 `TraceEvent` 가 없으면 더한다:

```ts
import type { TraceEvent } from "@trace/shared";
import { elementKey } from "./element-identity.js";
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/detection/detect.test.ts -t "요소 키를 싣는다"`

Expected: FAIL — `rage?.elementKey` 가 `undefined` 다.

- [ ] **Step 3: 반환 객체에 싣는다**

`apps/api/src/detection/detect.ts` 의 `makeIssue` 반환에서 `status: "new",` 바로 아래에 넣는다:

```ts
    // 조회 시점(admin-proxy 의 findRepresentativeEvent)이 이 값으로 후보를 좁힌다.
    // 이슈 id 에도 같은 값이 들어가지만 id 를 파싱하는 코드는 저장소에 0건이고
    // 그 성질은 유지한다.
    ...(input.elementKey ? { elementKey: input.elementKey } : {}),
```

- [ ] **Step 4: 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/detection/detect.test.ts`

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/detection/detect.ts apps/api/src/detection/detect.test.ts
git commit -m "기능: 탐지기가 이슈에 요소 키를 싣는다"
```

---

### Task 3: 두 테이블에 요소 키를 저장한다

**Files:**
- Modify: `apps/api/src/db/schema.sqlite.ts:13-35` (events DDL), `:42-58` (issues DDL)
- Modify: `apps/api/src/store/sqlite-store.ts:462-500` (`saveBatch`), `:517-551` (`upsertIssues`), `:690-708` (`toIssue`), `:712` (`migrate`)
- Test: `apps/api/src/store/sqlite-store.test.ts`, `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `Issue["elementKey"]`, `elementKey()` (`apps/api/src/detection/element-identity.ts`)
- Produces: `events.element_key` · `issues.element_key` 컬럼. Task 4 의 조회가 `events.element_key` 를 읽는다.

`MemoryStore` 는 이슈 객체를 그대로 들고 있어 저장 쪽 변경이 없다. 계약 테스트가 두 스토어를 같은 검사로 돌리므로 자동으로 확인된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 이슈 왕복**

`apps/api/src/store/store-contract.test.ts` 의 `describe(`${name} TraceStore 계약`, ...)` 안에 추가:

```ts
    // INSERT OR REPLACE 의 컬럼 목록·플레이스홀더·run() 인자 셋이 어긋나도
    // 타입 오류가 아니라 실행 시점 오류다. 왕복으로 잡는다.
    it("이슈의 요소 키가 저장 후 그대로 돌아온다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.upsertIssues(project.projectId, [
        {
          issueId: "issue__settings|0fd2102e520470ad|rage_click",
          projectId: project.projectId,
          issueType: "rage_click",
          title: "제목",
          summary: "요약",
          affectedSessionsCount: 1,
          affectedUsersCount: 1,
          severityScore: 70,
          firstSeenAt: "2026-09-04T00:00:00.000Z",
          lastSeenAt: "2026-09-04T00:00:01.000Z",
          trend: "flat",
          relatedUrlPath: "/settings",
          exampleSessionIds: ["sess_1"],
          status: "new",
          elementKey: "0fd2102e520470ad",
        },
        {
          issueId: "issue__settings|page|error_friction",
          projectId: project.projectId,
          issueType: "error_friction",
          title: "오류",
          summary: "요약",
          affectedSessionsCount: 1,
          affectedUsersCount: 1,
          severityScore: 60,
          firstSeenAt: "2026-09-04T00:00:00.000Z",
          lastSeenAt: "2026-09-04T00:00:00.000Z",
          trend: "flat",
          relatedUrlPath: "/settings",
          exampleSessionIds: ["sess_1"],
          status: "new",
        },
      ]);

      const issues = await store.listIssues(project.projectId);
      const rage = issues.find((issue) => issue.issueType === "rage_click");
      const error = issues.find((issue) => issue.issueType === "error_friction");

      expect(rage?.elementKey).toBe("0fd2102e520470ad");
      expect(error?.elementKey).toBeUndefined();
    });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/store/store-contract.test.ts -t "요소 키가 저장 후"`

Expected: SqliteStore 는 FAIL(`rage?.elementKey` 가 `undefined`), MemoryStore 는 PASS. 메모리는 객체를 그대로 들고 있어 이미 통과하는 것이 정상이다.

- [ ] **Step 3: 신규 DB 스키마에 컬럼을 더한다**

`apps/api/src/db/schema.sqlite.ts` 의 events 테이블에서 `error_line INTEGER` 다음 줄에 컬럼을 더한다 (앞줄 끝에 쉼표를 붙인다):

```sql
  error_line INTEGER,
  element_key TEXT
);
```

issues 테이블에서 `related_error_signature TEXT` 다음:

```sql
  related_error_signature TEXT,
  element_key TEXT
);
```

- [ ] **Step 4: 기존 DB 마이그레이션을 더한다**

`apps/api/src/store/sqlite-store.ts` 의 `migrate()` 안, `related_error_signature` 블록 바로 아래이자 `user_version` 블록 **위**에 넣는다:

```ts
    // 조회 시점에 SQL 로 요소를 거르기 위한 저장 컬럼이다. SQLite 에는 hash64Hex 가
    // 없어 WHERE 절에서 키를 만들어 낼 수 없다.
    //
    // 백필하지 않는다. user_version = 1 마이그레이션이 기존 이벤트의
    // element_selector_hash 를 이미 NULL 로 만들었으므로 옛 이벤트의 요소 키는
    // 어차피 undefined 다 — NULL 이 정확히 맞는 값이다.
    for (const table of ["events", "issues"]) {
      if (!hasColumn(this.db, table, "element_key")) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN element_key TEXT`);
      }
    }
```

`user_version` 블록 위에 두는 이유: 아래 블록은 `element_selector_hash` 를 지우는 일회성 정리이고, 컬럼이 먼저 있어야 순서가 헷갈리지 않는다. `hasColumn` 검사가 있어 반복 실행돼도 무해하다.

- [ ] **Step 5: 이벤트 INSERT 에 컬럼을 더한다**

`sqlite-store.ts` 의 `saveBatch`. 컬럼 목록(`:466-468`)에서 `error_line` 뒤에 `element_key` 를 더하고, `VALUES` 의 물음표를 22개에서 23개로 늘린다:

```ts
      `INSERT OR IGNORE INTO events
         (event_id, project_id, session_id, page_id, timestamp, received_at, type, url_path, url_query_redacted,
          title_masked, element_selector_hash, element_role, element_text_masked_or_limited,
          x, y, viewport_x, viewport_y, metadata, screen_context, error_name, error_source, error_line,
          element_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
```

그리고 `insert.run(...)` 의 마지막 인자 `event.errorLine ?? null,` 다음에 더한다:

```ts
          elementKey(event) ?? null,
```

상단 임포트에 더한다:

```ts
import { elementKey } from "../detection/element-identity.js";
```

- [ ] **Step 6: 이슈 UPSERT 에 컬럼을 더한다**

`sqlite-store.ts` 의 `upsertIssues`. 컬럼 목록에서 `related_error_signature` 뒤에 `element_key` 를 더하고 물음표를 16개에서 17개로 늘린다:

```ts
      `INSERT OR REPLACE INTO issues
         (issue_id, project_id, issue_type, title, summary, affected_sessions_count, affected_users_count,
          severity_score, first_seen_at, last_seen_at, trend, related_url_path, related_feature_id,
          example_session_ids, status, related_error_signature, element_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
```

`upsert.run(...)` 의 마지막 인자 `issue.relatedErrorSignature ?? null,` 다음에 더한다:

```ts
          issue.elementKey ?? null,
```

- [ ] **Step 7: 이슈 매핑에 컬럼을 더한다**

`sqlite-store.ts` 의 `toIssue`. `relatedErrorSignature` 줄 다음에 더한다:

```ts
      elementKey: row.element_key as string | null,
```

`compact()` 가 `null` 을 걷어내므로 값이 없으면 필드 자체가 안 생긴다.

`toEvent` 에는 **더하지 않는다.** `TraceEvent` 계약에 `elementKey` 가 없고, 이 컬럼은 조회용 저장값일 뿐이다.

- [ ] **Step 8: 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/store/store-contract.test.ts`

Expected: PASS — 두 스토어 모두.

- [ ] **Step 9: 마이그레이션 테스트를 쓴다**

`apps/api/src/store/sqlite-store.test.ts` 에 추가. 이 파일에는 이미 `createTempDbPath()` 헬퍼와 `afterEach` 정리가 있고 `SqliteStore` 는 `close()` 를 갖는다. 그 관례를 그대로 쓴다:

```ts
  it("컬럼이 없는 기존 DB 를 열면 element_key 가 생기고, 두 번 열어도 안전하다", () => {
    const dbPath = createTempDbPath();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE events (event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
        page_id TEXT NOT NULL, timestamp TEXT NOT NULL, type TEXT NOT NULL, url_path TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE issues (issue_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, issue_type TEXT NOT NULL,
        title TEXT NOT NULL, summary TEXT NOT NULL, affected_sessions_count INTEGER NOT NULL,
        affected_users_count INTEGER NOT NULL, severity_score INTEGER NOT NULL, first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL, trend TEXT NOT NULL, example_session_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL);
      INSERT INTO issues (issue_id, project_id, issue_type, title, summary, affected_sessions_count,
        affected_users_count, severity_score, first_seen_at, last_seen_at, trend, status)
      VALUES ('issue_old', 'proj_1', 'rage_click', '제목', '요약', 1, 1, 70,
        '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:01.000Z', 'flat', 'new');
    `);
    legacy.close();

    // 두 번 여는 것이 마이그레이션을 두 번 돌리는 것이다. hasColumn 검사가
    // 없으면 두 번째에서 "duplicate column name" 으로 던진다.
    const first = new SqliteStore(dbPath);
    first.close();
    const second = new SqliteStore(dbPath);
    second.close();

    const inspector = new Database(dbPath);
    const columns = (table: string) =>
      (inspector.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map((column) => column.name);

    expect(columns("events")).toContain("element_key");
    expect(columns("issues")).toContain("element_key");

    // 기존 이슈 행이 살아 있어야 한다. 트래픽이 있으면 다음 배치에서 키가 채워진다.
    expect(inspector.prepare("SELECT issue_id FROM issues").all()).toEqual([{ issue_id: "issue_old" }]);
    inspector.close();
  });
```

임시 디렉터리는 파일 상단의 `afterEach` 가 지우므로 별도 정리가 없다. 임포트는 이미 다 있다(`Database` · `SqliteStore` · `createTempDbPath`).

- [ ] **Step 10: 마이그레이션 테스트를 돌린다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/store/sqlite-store.test.ts`

Expected: PASS

- [ ] **Step 11: 전체를 돌린다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`

Expected: PASS

- [ ] **Step 12: 커밋**

```bash
git add apps/api/src/db/schema.sqlite.ts apps/api/src/store/sqlite-store.ts \
        apps/api/src/store/sqlite-store.test.ts apps/api/src/store/store-contract.test.ts
git commit -m "기능: 이벤트와 이슈에 요소 키를 저장한다"
```

---

### Task 4: 조회가 요소로 후보를 좁힌다

**Files:**
- Modify: `apps/api/src/store/types.ts:108-115` (`ScreenContextEventQuery`)
- Modify: `apps/api/src/store/sqlite-store.ts:575-612` (`findScreenContextEvents`)
- Modify: `apps/api/src/store/memory-store.ts:324-345` (`findScreenContextEvents`)
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: Task 3 의 `events.element_key`
- Produces: `findScreenContextEvents({ ..., elementKey })` — 키를 넘기면 그 요소의 이벤트만, 안 넘기면 지금 그대로. Task 5 가 호출한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/store/store-contract.test.ts` 의 계약 `describe` 안에 추가. **핵심 사례는 지문이 같고 글자만 다른 형제 버튼이다** — 이번 결함이 정확히 그것이다:

```ts
    it("요소 키를 넘기면 그 요소의 클릭만 돌려준다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const screenContext = {
        viewport: { width: 1440, height: 900 },
        target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
        layoutHints: [],
      };
      const click = (eventId: string, timestamp: string, hash: string | undefined, text: string) => ({
        eventId,
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp,
        type: "click" as const,
        urlPath: "/settings",
        ...(hash === undefined ? {} : { elementSelectorHash: hash }),
        elementTextMaskedOrLimited: text,
        metadata: {},
        screenContext,
      });

      // 리포트 내보내기와 오류 발생은 지문이 같고 글자만 다르다. 실제 데모에서
      // 관측된 형태이고, 이번 결함이 이 둘을 뭉갰다.
      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-04T00:00:10.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          click("evt_save", "2026-09-04T00:00:01.000Z", "1111111111111111", "저장"),
          click("evt_report", "2026-09-04T00:00:02.000Z", "2222222222222222", "리포트 내보내기"),
          click("evt_error", "2026-09-04T00:00:03.000Z", "2222222222222222", "오류 발생"),
          click("evt_legacy", "2026-09-04T00:00:04.000Z", undefined, "지문 없음"),
        ],
      });

      const query = {
        projectId: project.projectId,
        sessionIds: ["sess_1"],
        urlPath: "/settings",
        from: "2026-09-04T00:00:00.000Z",
        to: "2026-09-04T00:00:09.000Z",
      };

      const reportKey = elementKey(click("x", "2026-09-04T00:00:02.000Z", "2222222222222222", "리포트 내보내기") as TraceEvent);
      const errorKey = elementKey(click("x", "2026-09-04T00:00:03.000Z", "2222222222222222", "오류 발생") as TraceEvent);
      expect(reportKey).not.toBe(errorKey);

      const report = await store.findScreenContextEvents({ ...query, elementKey: reportKey });
      expect(report.map((event) => event.eventId)).toEqual(["evt_report"]);

      const error = await store.findScreenContextEvents({ ...query, elementKey: errorKey });
      expect(error.map((event) => event.eventId)).toEqual(["evt_error"]);

      // 키를 안 넘기면 지금 그대로 — 세션당 가장 이른 후보 하나.
      const unfiltered = await store.findScreenContextEvents(query);
      expect(unfiltered.map((event) => event.eventId)).toEqual(["evt_save"]);

      // 지문이 없는 옛 이벤트는 element_key 가 NULL 이라 어떤 키 조회에도 걸리지
      // 않는다. 위 두 단정이 evt_legacy 를 빼고 있지만, 요소 신원 마이그레이션이
      // 과거 지문을 전부 NULL 로 만들었으므로 이 성질을 따로 못박는다.
      const legacyKey = elementKey(click("x", "2026-09-04T00:00:04.000Z", undefined, "지문 없음") as TraceEvent);
      expect(legacyKey).toBeUndefined();

      const everyKeyed = await Promise.all(
        [reportKey, errorKey].map((key) => store.findScreenContextEvents({ ...query, elementKey: key })),
      );
      expect(everyKeyed.flat().map((event) => event.eventId)).not.toContain("evt_legacy");
    });
```

임포트에 `elementKey` 와 `TraceEvent` 가 없으면 더한다:

```ts
import type { TraceEvent } from "@trace/shared";
import { elementKey } from "../detection/element-identity.js";
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/store/store-contract.test.ts -t "요소 키를 넘기면"`

Expected: FAIL — 타입 오류(`elementKey` 가 쿼리에 없음) 또는 두 조회가 모두 `evt_save` 를 돌려준다.

- [ ] **Step 3: 쿼리 인터페이스에 필드를 더한다**

`apps/api/src/store/types.ts` 의 `ScreenContextEventQuery`:

```ts
export interface ScreenContextEventQuery {
  projectId: string;
  sessionIds: string[];
  urlPath?: string;
  from: string;
  to: string;
  types?: TraceEvent["type"][];
  // 넘기면 그 요소의 이벤트만 후보가 된다. 안 넘기면 요소로 거르지 않는다 —
  // 요소를 모르는 이슈(long_pause·error_friction)가 그 경로를 쓴다.
  elementKey?: string;
}
```

- [ ] **Step 4: SQLite 구현에 조건을 더한다**

`sqlite-store.ts` 의 `findScreenContextEvents`. `typeFilter` 아래에 더한다:

```ts
    const elementFilter = query.elementKey === undefined ? "" : " AND element_key = ?";
```

SQL 문자열의 `${typeFilter}` 뒤에 `${elementFilter}` 를 잇는다:

```ts
      `SELECT * FROM events
       WHERE project_id = ? AND session_id = ? AND screen_context IS NOT NULL${pathFilter}
         AND timestamp BETWEEN ? AND ?${typeFilter}${elementFilter}
       ORDER BY timestamp
       LIMIT ${SCREEN_CONTEXT_CANDIDATE_LIMIT}`,
```

`statement.all(...)` 의 인자 끝에 더한다:

```ts
        ...(query.types ?? []),
        ...(query.elementKey === undefined ? [] : [query.elementKey]),
```

상한이 이미 걸러진 행에만 적용되므로, 상한 안에 그 요소의 클릭이 없어 조용히 실패하는 일이 생기지 않는다.

- [ ] **Step 5: 메모리 구현에 조건을 더한다**

`memory-store.ts` 의 `findScreenContextEvents` 필터 마지막 조건 뒤에 더한다:

```ts
            (query.types === undefined || query.types.length === 0 || query.types.includes(event.type)) &&
            (query.elementKey === undefined || elementKey(event) === query.elementKey),
```

상단 임포트에 더한다:

```ts
import { elementKey } from "../detection/element-identity.js";
```

메모리 스토어는 이벤트 객체를 그대로 들고 있으므로 저장된 컬럼 대신 그 자리에서 계산한다. 같은 함수를 쓰므로 두 스토어의 판정이 갈라지지 않는다.

- [ ] **Step 6: 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/store/store-contract.test.ts`

Expected: PASS — 두 스토어 모두.

- [ ] **Step 7: 전체를 돌린다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`

Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/api/src/store/types.ts apps/api/src/store/sqlite-store.ts \
        apps/api/src/store/memory-store.ts apps/api/src/store/store-contract.test.ts
git commit -m "기능: 화면 맥락 조회가 요소로 후보를 좁힌다"
```

---

### Task 5: 대표 이벤트 선택이 요소 키로 갈린다

**Files:**
- Modify: `apps/api/src/routes/admin-proxy.ts:525-557` (`REPRESENTATIVE_LEAD_IN_MS` · `findRepresentativeEvent` · `representativeWindowStart`)
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `Issue["elementKey"]`, Task 4 의 `findScreenContextEvents({ elementKey })`
- Produces: 이 태스크가 마지막 코드 변경이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/routes/admin.test.ts` 에 추가. 기존 대표 이벤트 테스트(`:2262` 근처)의 `signedInStore()` · `addProjectMembership` 관례를 그대로 따른다:

```ts
  it("요소 키가 있는 이슈는 다른 요소의 클릭을 대표로 쓰지 않는다", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-09-04T00:00:00.000Z",
    });

    const screenContext = {
      viewport: { width: 1440, height: 900 },
      target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
      layoutHints: [],
    };
    const click = (eventId: string, timestamp: string, hash: string, text: string) => ({
      eventId,
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp,
      type: "click" as const,
      urlPath: "/settings",
      elementSelectorHash: hash,
      elementTextMaskedOrLimited: text,
      metadata: {},
      screenContext,
    });

    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-04T00:00:10.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        // 이슈 구간 밖(lead-in 자리)의 같은 요소 클릭. lead-in 을 없앴으므로 안 뽑혀야 한다.
        click("evt_target_before", "2026-09-04T00:00:00.000Z", "1111111111111111", "권한 추가"),
        // 이슈 구간 안이지만 다른 요소. 지금 결함이 이것을 뽑는다.
        click("evt_other", "2026-09-04T00:00:04.900Z", "2222222222222222", "저장"),
        click("evt_target_in", "2026-09-04T00:00:05.000Z", "1111111111111111", "권한 추가"),
      ],
    });

    const targetKey = elementKey(click("x", "2026-09-04T00:00:05.000Z", "1111111111111111", "권한 추가") as TraceEvent)!;

    await store.upsertIssues(project.projectId, [
      {
        issueId: `issue__settings|${targetKey}|rage_click`,
        projectId: project.projectId,
        issueType: "rage_click",
        title: "/settings 화면에서 반복 클릭이 감지되었습니다",
        summary: "3회 클릭이 3초 안에 같은 요소에서 발생했습니다.",
        affectedSessionsCount: 1,
        affectedUsersCount: 1,
        severityScore: 70,
        firstSeenAt: "2026-09-04T00:00:05.000Z",
        lastSeenAt: "2026-09-04T00:00:06.000Z",
        trend: "flat",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
        elementKey: targetKey,
      },
    ]);

    const app = createApp({ store, authConfig });
    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].representativeEvent).toMatchObject({ eventId: "evt_target_in" });
  });

  it("요소 키가 없는 이슈는 30초 앞 클릭을 계속 쓴다", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-09-04T00:00:00.000Z",
    });

    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-04T00:00:40.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_click_before_error",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-04T00:00:20.000Z",
          type: "click",
          urlPath: "/settings",
          elementSelectorHash: "3333333333333333",
          elementTextMaskedOrLimited: "오류 발생",
          metadata: {},
          screenContext: {
            viewport: { width: 1440, height: 900 },
            target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
            layoutHints: [],
          },
        },
      ],
    });

    // 오류 이벤트에는 화면 맥락이 없다. 이슈 시점은 클릭보다 20초 뒤라
    // lead-in 이 없으면 후보가 사라진다 — 그래서 이 부류에서는 유지한다.
    await store.upsertIssues(project.projectId, [
      {
        issueId: "issue__settings|page|error_friction",
        projectId: project.projectId,
        issueType: "error_friction",
        title: "/settings 화면에서 오류 기반 막힘이 감지되었습니다",
        summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
        affectedSessionsCount: 1,
        affectedUsersCount: 1,
        severityScore: 60,
        firstSeenAt: "2026-09-04T00:00:40.000Z",
        lastSeenAt: "2026-09-04T00:00:40.000Z",
        trend: "flat",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
      },
    ]);

    const app = createApp({ store, authConfig });
    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].representativeEvent).toMatchObject({ eventId: "evt_click_before_error" });
  });

  it("요소가 일치하는 클릭이 없으면 다른 화면으로 채우지 않는다", async () => {
    const { store, user, cookie } = await signedInStore();
    const project = await store.createProject({ name: "Settings", allowedDomains: ["https://example.com"] });
    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-09-04T00:00:00.000Z",
    });

    // 이슈 구간 안에 클릭이 있지만 전부 다른 요소다. 예전에는 이 클릭이 뽑혀
    // 형제 버튼의 화면을 근거로 보여줬다. 이제는 비운다.
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-04T00:00:10.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_other_only",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-04T00:00:05.000Z",
          type: "click",
          urlPath: "/settings",
          elementSelectorHash: "9999999999999999",
          elementTextMaskedOrLimited: "저장",
          metadata: {},
          screenContext: {
            viewport: { width: 1440, height: 900 },
            target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
            layoutHints: [],
          },
        },
      ],
    });

    await store.upsertIssues(project.projectId, [
      {
        issueId: "issue__settings|1111111111111111|rage_click",
        projectId: project.projectId,
        issueType: "rage_click",
        title: "/settings 화면에서 반복 클릭이 감지되었습니다",
        summary: "3회 클릭이 3초 안에 같은 요소에서 발생했습니다.",
        affectedSessionsCount: 1,
        affectedUsersCount: 1,
        severityScore: 70,
        firstSeenAt: "2026-09-04T00:00:05.000Z",
        lastSeenAt: "2026-09-04T00:00:06.000Z",
        trend: "flat",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
        elementKey: "1111111111111111",
      },
    ]);

    const app = createApp({ store, authConfig });
    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/issues`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).not.toHaveProperty("representativeEvent");
  });
```

임포트에 `elementKey` · `TraceEvent` 가 없으면 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/routes/admin.test.ts -t "요소 키가"`

Expected: 첫 테스트 FAIL(`evt_target_before` 가 뽑힌다 — lead-in 이 살아 있고 요소를 안 본다), 둘째 PASS.

- [ ] **Step 3: 선택 로직을 갈래로 나눈다**

`apps/api/src/routes/admin-proxy.ts` 의 `findRepresentativeEvent` 를 통째로 바꾼다:

```ts
async function findRepresentativeEvent(
  store: TraceStore,
  projectId: string,
  issue: Issue,
): Promise<TraceEvent | undefined> {
  const sessionIds = issue.exampleSessionIds.slice(0, 3);
  if (sessionIds.length === 0) return undefined;

  const base = {
    projectId,
    sessionIds,
    ...(issue.relatedUrlPath === undefined ? {} : { urlPath: issue.relatedUrlPath }),
  };

  // 요소를 아는 이슈는 그 요소의 클릭만 쓴다. 화면 맥락을 싣는 이벤트가 클릭뿐이라
  // 유형별 선호 타입을 거는 단계가 의미를 잃고, 조회가 한 번으로 끝난다.
  //
  // 창도 이슈 자신의 구간으로 좁힌다. 그 이슈를 만든 클릭들은 정의상 이 구간 안에
  // 있고 전부 화면 맥락을 갖는다(2026-09-04 실측: 클릭 19건 전건). lead-in 은
  // 요소를 모르는 이슈를 위한 장치다.
  if (issue.elementKey !== undefined) {
    const matched = await store.findScreenContextEvents({
      ...base,
      elementKey: issue.elementKey,
      from: issue.firstSeenAt,
      to: issue.lastSeenAt,
    });
    return matched[0];
  }

  // 요소를 모르는 이슈(long_pause·error_friction). 근거 이벤트에 화면 맥락이 없어
  // 주변 클릭을 빌려온다. 기존 동작을 그대로 유지한다.
  const query = {
    ...base,
    from: representativeWindowStart(issue.firstSeenAt),
    to: issue.lastSeenAt,
  };

  const preferred = await store.findScreenContextEvents({
    ...query,
    types: REPRESENTATIVE_EVENT_TYPES[issue.issueType],
  });
  if (preferred[0]) return preferred[0];

  const withinWindow = await store.findScreenContextEvents(query);
  return withinWindow[0];
}
```

`REPRESENTATIVE_LEAD_IN_MS` · `REPRESENTATIVE_EVENT_TYPES` · `representativeWindowStart` 는 그대로 둔다. 요소를 모르는 갈래가 계속 쓴다.

- [ ] **Step 4: 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/routes/admin.test.ts`

Expected: PASS

기존 테스트가 깨지면 **단정을 약화시키지 말고** 무엇이 왜 바뀌었는지 확인한다. `:2262` 의 `evt_click` 기대는 이슈에 `elementKey` 가 없어 옛 갈래를 타므로 그대로 통과해야 한다.

- [ ] **Step 5: 전체·타입·빌드**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`
Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck`
Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build`

Expected: 모두 PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.test.ts
git commit -m "수정: 대표 이벤트를 이슈 자신의 요소 클릭으로 고른다"
```

---

### Task 6: 실수집으로 검증한다

**Files:**
- Modify: 검증 실패가 Task 1-5 가 만든 구체적 버그를 가리킬 때만.

**Interfaces:**
- Consumes: 앞선 모든 태스크
- Produces: 시드가 아닌 실제 브라우저 수집에서 각 이슈가 자기 요소의 화면을 쓴다는 증거

시드 데이터가 이 결함을 숨겼으므로 마지막 검증은 실수집으로 한다.

- [ ] **Step 1: 서버 세 개를 띄운다**

사용자 서버(:4000, :5173)와 충돌하지 않게 별도 포트를 쓴다.

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH NODE_ENV=development PORT=4100 \
  TRACE_DB_PATH=/private/tmp/trace-repr.db GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy \
  GOOGLE_REDIRECT_URI=http://localhost:4100/auth/google/callback \
  SESSION_SECRET=0123456789abcdef0123456789abcdef ADMIN_APP_ORIGIN=http://localhost:5174 \
  ADMIN_ALLOWED_EMAILS=admin@example.com COOKIE_SECURE=false LOCAL_ADMIN_LOGIN=true npm run dev:api
```

```bash
cd apps/admin && VITE_API_BASE_URL=http://localhost:4100 \
  ../../node_modules/.bin/vite --host 127.0.0.1 --port 5174 --strictPort
```

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run dev:demo -- --port 5175 --strictPort
```

`npm run dev:admin -- --port 5174` 는 인자가 전달되지 않아 5173 으로 뜬다. 위처럼 `vite` 를 직접 부른다.

- [ ] **Step 2: 프로젝트를 만든다**

```bash
curl -s -c /tmp/trace-cookies.txt -o /dev/null http://localhost:4100/auth/local/start
CSRF=$(grep __trace_csrf /tmp/trace-cookies.txt | awk '{print $7}')
curl -s -b /tmp/trace-cookies.txt -X POST http://localhost:4100/admin/api/projects \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5174" -H "x-trace-csrf: $CSRF" \
  -d '{"name":"대표 이벤트 검증","allowedDomains":["http://localhost:5175"]}'
```

- [ ] **Step 3: 데모에서 실제로 클릭한다**

`http://localhost:5175/?projectId=<위에서 받은 id>&port=4100` 을 열고 **네 버튼을 섞어** 누른다. `권한 추가` 를 여러 번(분노 클릭 유발), `저장` 한 번, `리포트 내보내기` 여러 번, `오류 발생` 여러 번.

`리포트 내보내기` 와 `오류 발생` 은 지문이 같고 글자만 다르다. 이 쌍이 핵심 사례다.

- [ ] **Step 4: 저장된 요소 키를 확인한다**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH node -e '
const db = require("better-sqlite3")("/private/tmp/trace-repr.db", {readonly:true});
console.log("이벤트 요소 키:");
for (const row of db.prepare("SELECT element_text_masked_or_limited t, element_selector_hash h, element_key k FROM events WHERE type = @ty").all({ty:"click"})) {
  console.log(`  ${(row.t||"-").padEnd(14)} 지문=${row.h||"-"} 키=${row.k||"-"}`);
}
console.log("이슈 요소 키:");
for (const row of db.prepare("SELECT issue_id, issue_type, element_key FROM issues").all()) {
  console.log(`  ${row.issue_type.padEnd(20)} ${row.element_key||"(없음)"}  ${row.issue_id}`);
}
'
```

Expected: 클릭마다 `키` 가 16 hex 로 채워져 있다. `리포트 내보내기` 와 `오류 발생` 은 **지문이 같은데 키가 다르다.** `rage_click` · `dead_click_cluster` 이슈에는 키가 있고 `error_friction` 에는 없다.

- [ ] **Step 5: 관리자에서 근거를 확인한다**

`http://localhost:4100/auth/local/start` 로 로그인하고 관리자에서 확인한다.

- 각 이슈의 근거 표에 뜨는 `화면 내 클릭` 이 **그 이슈의 버튼**과 일치한다
- `권한 추가` 반복 클릭 이슈가 `저장` 클릭을 표시하지 **않는다** (2026-09-02 관측 회귀)
- `리포트 내보내기` 이슈와 `오류 발생` 이슈가 서로의 화면을 빌려오지 **않는다**
- `오류 마찰` 이슈는 예전처럼 주변 클릭의 화면을 쓴다

스크린샷을 남기고 리포트에 경로를 적는다.

- [ ] **Step 6: 정리**

띄운 서버를 종료하고(사용자의 :4000/:5173 은 건드리지 않는다) 임시 파일을 지운다.

```bash
rm -f /private/tmp/trace-repr.db /tmp/trace-cookies.txt
```

- [ ] **Step 7: git 정합성 확인**

Run: `git status --short`

Expected: 이 기능의 파일만 변경돼 있다. 무관한 사용자 변경은 그대로 둔다.

- [ ] **Step 8: 검증 수정이 있었으면 커밋**

Step 1-7 이 코드 변경을 요구했으면 그 파일만 커밋한다. 없으면 빈 커밋을 만들지 않는다.

```bash
git add <정확히 변경한 파일>
git commit -m "수정: 대표 이벤트 실수집 검증에서 나온 문제를 고친다"
```

---

## 완료 기준

스펙 §5 를 그대로 옮긴다.

- [ ] 실수집에서 요소 키가 있는 모든 이슈의 대표 이벤트가 **그 이슈의 요소 클릭**이다 (Task 6 Step 5)
- [ ] 요소 키가 있는 이슈의 대표 이벤트 시각이 항상 이슈 시간 구간 안이다 (Task 5 Step 1 의 `evt_target_before` 단정)
- [ ] `error_friction` · `long_pause` 의 선택 동작이 변하지 않는다 (Task 5 Step 1 의 둘째 테스트)
- [ ] 마이그레이션 후 기존 이슈가 사라지지 않는다 (Task 3 Step 9)
- [ ] 두 스토어가 새 조회 조건에서 같게 동작한다 (Task 4 — 계약 테스트가 두 스토어를 함께 돌린다)
- [ ] 기준선 623 테스트가 계속 통과한다 (각 태스크의 `npm test`)
