# ③-1 서버 집계 API 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 화면 세 개(기능 사용·이동 흐름·세션)가 쓸 서버 API를 만든다. 기능 사용 API와 경로 순위 API를 새로 만들고, 세션 목록 API에 기간과 필터를 더한다. 관리자 화면은 바꾸지 않는다.

**Architecture:** 세 API 모두 "기간 세션"(기준 시각 이후에 시작한 세션)에서 출발하는 SQL을 쓴다. SQL은 `store/analytics-sql.ts`에 상수로 모으고, `store/analytics.ts`의 `Analytics` 클래스가 SQL을 실행해 응답 모양으로 묶는다. `SqliteStore`는 이 클래스에 위임만 한다. 경로 규칙(같은 화면 합치기, 시작 화면에서 자르기, 이탈 붙이기)은 `store/route.ts`의 순수 함수 하나에 두고, 경로 순위·경로 필터·세션 행의 지나간 화면이 같이 쓴다. 쿼리 파라미터 해석은 `routes/aggregation-query.ts`의 순수 함수가 맡는다.

**Tech Stack:** TypeScript, npm workspaces, vitest, Fastify 5, better-sqlite3(SQLite 3.53), zod

**Spec:** `docs/superpowers/specs/2026-10-10-stage3-1-aggregation-api-design.md`(이 계획의 근거). 집계 기준의 원래 정의는 `docs/superpowers/specs/2026-09-30-behavior-analytics-redefinition-design.md`의 "집계 기준".

## Global Constraints

- 응답, 커밋 메시지, 사용자에게 보이는 문구는 한국어로 쓴다. 코드 식별자, 명령, 경로는 원문 그대로 둔다.
- 커밋 메시지는 이 저장소 관례(`<영역>: <한국어 문장>`)를 따르고 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 워크트리는 `git worktree add .worktrees/<name> -b feature/<name>`으로 로컬 HEAD 기준으로 만든다. `EnterWorktree`는 쓰지 않는다.
- `git push`는 하지 않는다. 푸시는 사용자가 한다.
- 기간: `?days=1|7|30`, 없으면 7. 그 밖의 값이면 400 `{ "error": "invalid_period" }`.
- 기간 세션: **기간 안에 시작한 세션만 넣고, 넣은 세션은 이벤트 전부를 센다.** 시각은 이벤트의 `timestamp`(브라우저 시계)로 판단한다. 기준 시각과 같은 시각에 시작한 세션은 넣는다(`>=`).
- 화면 이름: 경로마다 기간 세션 안에서 가장 많이 나온 `titleMasked`, 횟수가 같으면 문자열 비교로 앞선 제목, 제목이 없으면 경로 그대로.
- 기능 하나 = `(url_path, element_key)`. 이름은 `element_text_masked_or_limited`, 없으면 `element_role`. `element_key`가 없는 클릭은 세지 않는다.
- 체류와 이탈은 `store/page-stats.ts`의 정의 그대로다(다음 `page_view`까지 양 끝 포함, `<=`).
- 경로: 연달아 같은 경로를 합치고, 시작 화면이 처음 나온 지점부터 자르고, 앞 5개를 쓰고, 5개 이하로 끝나면 `exited: true`.
- 상한: 화면 100개, 화면당 기능 30개, 경로 20개, 세션 50개.
- 세션 필터는 하나만. 섞이거나 짝이 안 맞으면 400 `{ "error": "invalid_session_filter" }`.
- `page-stats` API와 `listPageStats`는 지우지 않는다(③-2에서 지운다).
- 응답에는 `cache-control: no-store`를 붙인다.
- 스키마는 `CREATE INDEX IF NOT EXISTS`·`DROP INDEX IF EXISTS`만 바꾼다. 로컬 SQLite를 지우거나 비우는 SQL은 명령줄에 쓰지 않는다(`db-migration-guard` 훅이 막는다).
- 태스크가 끝날 때마다 워크트리 루트에서 `npm run typecheck`와 `npm test`가 모두 통과해야 한다.

## Review Focus

스펙이 직접 말하지 않지만 쓰는 사람을 가장 먼저 물 다섯 가지다. 각 줄의 테스트를 담당 태스크에 넣었다.

1. **기준 시각과 정확히 같은 밀리초에 시작한 세션:** 빠지면 "최근 1일"의 첫 세션이 사라진다. `>=`로 넣는다. → 태스크 3 `analytics.test.ts` "기간 안에 시작한 세션만 넣고, 넣은 세션은 기준 시각 뒤 이벤트까지 센다"의 `sess_edge`
2. **같은 밀리초의 `page_view` 둘**(라우터가 리다이렉트를 같은 tick에 처리할 때): 저장한 순서로 놓아야 경로가 실행할 때마다 바뀌지 않는다. → 태스크 4 "같은 밀리초의 page_view 는 저장한 순서로 놓는다"
3. **`page_view`가 하나도 없는 세션**(클릭만 남은 세션): 경로 순위의 분모에서는 빠지고, 세션 목록에는 화면 0개로 나온다. 나눗셈이 0으로 나뉘지 않는다. → 태스크 4 "page_view 가 없는 세션은 경로 대상에서 빠진다", 태스크 5 "page_view 가 없는 세션은 화면 0개로 나온다"
4. **경로에 `:`와 한글이 든 필터 URL**(`/quote/:id`, `/견적`): 인코딩된 값을 풀어 그대로 비교한다. → 태스크 5 라우트 테스트 "인코딩한 경로 필터로 세션을 거른다"
5. **시작 화면이 어느 세션에도 없을 때:** 400이 아니라 빈 순위이고, 비율에 `NaN`이 없다. → 태스크 1 "대상 세션이 없으면 빈 순위이고 비율을 나누지 않는다", 태스크 4 "시작 화면이 어느 세션에도 없으면 비어 있다"

스펙에 없던 작은 결정 두 가지를 이 계획에서 정했다. 리뷰에서 함께 본다.
- `paths`의 `start`가 빈 문자열이면 "전체"로 본다. 같은 키가 둘 이상이면 400 `{ "error": "invalid_path_start" }`.
- 경로 필터의 `step`은 1~5개다. 6개 이상은 어떤 세션과도 맞을 수 없으므로 400 `invalid_session_filter`.

## 파일 지도

**새로 만듦**
- `apps/api/src/store/route.ts`: 경로 규칙(합치기, 자르기, 순위 묶기)과 문자열 비교. 순수 함수
- `apps/api/src/store/analytics-sql.ts`: 기간 세션 CTE와 집계 SQL 상수
- `apps/api/src/store/analytics.ts`: `Analytics` 클래스. SQL을 실행해 응답 모양으로 묶는다
- `apps/api/src/routes/aggregation-query.ts`: `days`, `start`, 세션 필터 쿼리 해석. 순수 함수
- 테스트: `store/route.test.ts`, `store/analytics-sql.test.ts`, `store/analytics.test.ts`, `routes/aggregation-query.test.ts`

**고침**
- `apps/api/src/db/schema.sqlite.ts`: 인덱스 교체
- `apps/api/src/store/types.ts`: 응답 타입, `SessionFilter`, `TraceStore` 메서드
- `apps/api/src/store/sqlite-store.ts`: `Analytics`에 위임, 옛 `listSessions` 본문 삭제
- `apps/api/src/routes/admin-proxy.ts`: `features`·`paths` 라우트, `sessions` 확장
- 테스트: `routes/admin.test.ts`, `store/store-contract.test.ts`, `routes/ingestion.test.ts`

---

### Task 0: 계획 커밋, 작업 워크트리와 기준선

**Files:** 이 계획 파일

- [ ] **Step 1: 계획을 main 에 커밋한다**

```bash
cd /Users/choimiae/workspace/trace
git status --short     # 이 계획 파일 하나만 보여야 한다
git add docs/superpowers/plans/2026-10-10-stage3-1-aggregation-api.md
git commit -q -m "문서: ③-1 서버 집계 API 구현 계획을 쓴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: 워크트리를 만든다**

```bash
git worktree add .worktrees/aggregate -b feature/aggregate
cd .worktrees/aggregate
npm install
```

- [ ] **Step 3: 기준선을 잰다**

```bash
npm run build
npm run typecheck
npm test 2>&1 | tail -5
```

Expected: 빌드 성공, 타입 오류 없음, `Test Files  62 passed (62)`, `Tests  633 passed (633)`. 숫자가 다르면 기록해 두고 진행한다. 실패가 있으면 멈추고 보고한다.

---

### Task 1: 경로 규칙 함수

**Files:**
- Create: `apps/api/src/store/route.ts`
- Test: `apps/api/src/store/route.test.ts`
- Modify: `apps/api/src/store/types.ts` (`RankedPath` 추가)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `ROUTE_MAX_STEPS = 5`
  - `interface Route { steps: string[]; exited: boolean }`
  - `collapseScreens(urlPaths: readonly string[]): string[]`
  - `toRoute(screens: readonly string[], start?: string): Route | undefined` (`screens`는 이미 합친 배열)
  - `sameRoute(a: Route, b: Route): boolean`
  - `rankRoutes(sessions: Iterable<readonly string[]>, start: string | undefined, limit: number): { totalSessions: number; paths: RankedPath[] }` (`sessions`의 각 배열은 이미 합친 배열)
  - `compareText(a: string, b: string): number`
  - `types.ts`: `interface RankedPath { steps: string[]; exited: boolean; sessions: number; ratio: number }`

- [ ] **Step 1: `RankedPath` 타입을 더한다**

`apps/api/src/store/types.ts`에서 `PageStats` 인터페이스 바로 뒤(`export interface TraceStore {` 앞)에 넣는다.

```ts
/** 이동 흐름 화면의 경로 한 줄. */
export interface RankedPath {
  /** 시작 화면부터 최대 5개의 경로(urlPath). */
  steps: string[];
  /** 5개 화면 안에서 세션이 끝났는지. 화면은 끝에 "이탈"을 붙인다. */
  exited: boolean;
  sessions: number;
  /** sessions ÷ 대상 세션 수. 0~1. */
  ratio: number;
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/api/src/store/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { collapseScreens, compareText, rankRoutes, sameRoute, toRoute } from "./route.js";

describe("collapseScreens", () => {
  it("연달아 같은 화면을 하나로 합친다", () => {
    expect(collapseScreens(["/a", "/a", "/b", "/b", "/b"])).toEqual(["/a", "/b"]);
  });

  it("떨어져서 다시 나온 화면은 합치지 않는다", () => {
    expect(collapseScreens(["/a", "/b", "/a"])).toEqual(["/a", "/b", "/a"]);
  });

  it("빈 배열은 빈 배열이다", () => {
    expect(collapseScreens([])).toEqual([]);
  });
});

describe("toRoute", () => {
  it("시작 화면이 없으면 처음부터 쓰고, 5개 안에서 끝나면 이탈이다", () => {
    expect(toRoute(["/", "/quote", "/quote/new"])).toEqual({ steps: ["/", "/quote", "/quote/new"], exited: true });
  });

  it("시작 화면이 처음 나온 지점부터 자른다", () => {
    expect(toRoute(["/", "/quote", "/pay", "/quote", "/x"], "/quote")).toEqual({
      steps: ["/quote", "/pay", "/quote", "/x"],
      exited: true,
    });
  });

  it("시작 화면이 없는 세션은 빠진다", () => {
    expect(toRoute(["/", "/quote"], "/pay")).toBeUndefined();
  });

  it("화면이 없는 세션은 빠진다", () => {
    expect(toRoute([])).toBeUndefined();
  });

  it("5개를 넘으면 앞 5개만 쓰고 이탈이 아니다", () => {
    expect(toRoute(["/1", "/2", "/3", "/4", "/5", "/6"])).toEqual({
      steps: ["/1", "/2", "/3", "/4", "/5"],
      exited: false,
    });
  });

  it("정확히 5개면 이탈이다", () => {
    expect(toRoute(["/1", "/2", "/3", "/4", "/5"])?.exited).toBe(true);
  });

  it("자른 뒤 5개를 센다", () => {
    expect(toRoute(["/0", "/1", "/2", "/3", "/4", "/5"], "/1")).toEqual({
      steps: ["/1", "/2", "/3", "/4", "/5"],
      exited: true,
    });
  });
});

describe("sameRoute", () => {
  it("화면 순서와 이탈 여부가 모두 같아야 같다", () => {
    expect(sameRoute({ steps: ["/a", "/b"], exited: true }, { steps: ["/a", "/b"], exited: true })).toBe(true);
    expect(sameRoute({ steps: ["/a", "/b"], exited: true }, { steps: ["/a", "/b"], exited: false })).toBe(false);
    expect(sameRoute({ steps: ["/a", "/b"], exited: true }, { steps: ["/a"], exited: true })).toBe(false);
    expect(sameRoute({ steps: ["/a", "/b"], exited: true }, { steps: ["/b", "/a"], exited: true })).toBe(false);
  });
});

describe("rankRoutes", () => {
  it("같은 경로끼리 묶어 많은 순으로 세고 비율을 낸다", () => {
    const sessions = [["/", "/a"], ["/", "/a"], ["/", "/b"], ["/a"]];

    expect(rankRoutes(sessions, undefined, 20)).toEqual({
      totalSessions: 4,
      paths: [
        { steps: ["/", "/a"], exited: true, sessions: 2, ratio: 0.5 },
        // 세션 수가 같으면 경로를 이은 문자열 순이다. "/" 뒤의 구분자가 "a" 보다 앞선다.
        { steps: ["/", "/b"], exited: true, sessions: 1, ratio: 0.25 },
        { steps: ["/a"], exited: true, sessions: 1, ratio: 0.25 },
      ],
    });
  });

  it("화면 순서가 같아도 이탈 여부가 다르면 따로 센다", () => {
    const sessions = [
      ["/1", "/2", "/3", "/4", "/5"],
      ["/1", "/2", "/3", "/4", "/5", "/6"],
    ];

    const { paths } = rankRoutes(sessions, undefined, 20);

    // 같은 순서면 이탈하지 않은 쪽이 앞이다.
    expect(paths.map((path) => [path.exited, path.sessions])).toEqual([
      [false, 1],
      [true, 1],
    ]);
  });

  it("시작 화면으로 자르고, 그 화면이 없는 세션은 분모에서도 뺀다", () => {
    const sessions = [["/", "/a", "/b"], ["/a"], ["/", "/c"]];

    expect(rankRoutes(sessions, "/a", 20)).toEqual({
      totalSessions: 2,
      paths: [
        // "/a" 가 "/a"+구분자+"/b" 의 앞부분이라 먼저 온다.
        { steps: ["/a"], exited: true, sessions: 1, ratio: 0.5 },
        { steps: ["/a", "/b"], exited: true, sessions: 1, ratio: 0.5 },
      ],
    });
  });

  it("상위 limit 개만 남기되 비율의 분모는 전체 대상 세션이다", () => {
    const sessions = [["/a"], ["/a"], ["/b"], ["/c"]];

    expect(rankRoutes(sessions, undefined, 1)).toEqual({
      totalSessions: 4,
      paths: [{ steps: ["/a"], exited: true, sessions: 2, ratio: 0.5 }],
    });
  });

  it("대상 세션이 없으면 빈 순위이고 비율을 나누지 않는다", () => {
    expect(rankRoutes([["/a"]], "/zzz", 20)).toEqual({ totalSessions: 0, paths: [] });
  });
});

describe("compareText", () => {
  it("코드 단위 순으로 비교한다", () => {
    expect(["나", "가", "/b", "/a"].sort(compareText)).toEqual(["/a", "/b", "가", "나"]);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run apps/api/src/store/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route.js"`

- [ ] **Step 4: 구현한다**

`apps/api/src/store/route.ts`:

```ts
import type { RankedPath } from "./types.js";

// 경로 규칙. 경로 순위, 세션 목록의 경로 필터, 세션 행의 지나간 화면이 모두
// 이 파일의 함수를 쓴다 — 셋이 같은 규칙으로 잘라야 순위의 세션 수와 필터한
// 목록의 건수가 맞는다. 설계: docs/superpowers/specs/2026-10-10-stage3-1-aggregation-api-design.md

export const ROUTE_MAX_STEPS = 5;

export interface Route {
  /** 시작 화면부터 최대 5개. */
  steps: string[];
  /** 자른 경로가 5개 화면 안에서 끝났는지. */
  exited: boolean;
}

/** 연달아 같은 경로(새로고침, 같은 화면 안의 라우팅)를 하나로 합친다. 떨어져 다시 나온 경로는 남긴다. */
export function collapseScreens(urlPaths: readonly string[]): string[] {
  const collapsed: string[] = [];
  for (const urlPath of urlPaths) {
    if (collapsed[collapsed.length - 1] !== urlPath) collapsed.push(urlPath);
  }
  return collapsed;
}

/**
 * 합친 화면 배열을 시작 화면이 처음 나온 지점에서 잘라 경로로 만든다.
 * 화면이 없거나 시작 화면이 없는 세션은 대상이 아니다.
 */
export function toRoute(screens: readonly string[], start?: string): Route | undefined {
  const from = start === undefined ? 0 : screens.indexOf(start);
  if (from < 0 || screens.length === 0) return undefined;
  const tail = screens.slice(from);
  return { steps: tail.slice(0, ROUTE_MAX_STEPS), exited: tail.length <= ROUTE_MAX_STEPS };
}

export function sameRoute(a: Route, b: Route): boolean {
  return (
    a.exited === b.exited &&
    a.steps.length === b.steps.length &&
    a.steps.every((step, index) => step === b.steps[index])
  );
}

/**
 * 세션들의 경로를 묶어 세션 수가 많은 순으로 센다. 세션 수가 같으면 경로를
 * 이은 문자열 순, 그것도 같으면 이탈하지 않은 쪽이 앞이다 — 결과가 실행마다
 * 흔들리지 않게 한다. 비율의 분모는 잘리지 않은 대상 세션 전체다.
 */
export function rankRoutes(
  sessions: Iterable<readonly string[]>,
  start: string | undefined,
  limit: number,
): { totalSessions: number; paths: RankedPath[] } {
  const groups = new Map<string, { route: Route; sessions: number }>();
  let totalSessions = 0;
  for (const screens of sessions) {
    const route = toRoute(screens, start);
    if (!route) continue;
    totalSessions += 1;
    const key = `${joinSteps(route.steps)}\u0000${route.exited ? 1 : 0}`;
    const group = groups.get(key);
    if (group) group.sessions += 1;
    else groups.set(key, { route, sessions: 1 });
  }

  const paths = [...groups.values()]
    .sort(
      (a, b) =>
        b.sessions - a.sessions ||
        compareText(joinSteps(a.route.steps), joinSteps(b.route.steps)) ||
        Number(a.route.exited) - Number(b.route.exited),
    )
    .slice(0, limit)
    .map(({ route, sessions }) => ({ ...route, sessions, ratio: sessions / totalSessions }));
  return { totalSessions, paths };
}

/** 로캘을 타지 않는 코드 단위 비교. SQLite 의 기본(BINARY) 정렬과 같은 순서다. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// NUL 은 경로에 나올 수 없어 경계가 겹치지 않는다.
function joinSteps(steps: readonly string[]): string {
  return steps.join("\u0000");
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run apps/api/src/store/route.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 6: 전체 확인 후 커밋한다**

```bash
npm run typecheck && npm test 2>&1 | tail -4
git add apps/api/src/store/route.ts apps/api/src/store/route.test.ts apps/api/src/store/types.ts
git commit -q -m "집계: 경로를 합치고 자르고 묶어 세는 규칙을 둔다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 집계 쿼리 파라미터 해석

**Files:**
- Create: `apps/api/src/routes/aggregation-query.ts`
- Test: `apps/api/src/routes/aggregation-query.test.ts`
- Modify: `apps/api/src/store/types.ts` (`SessionFilter` 추가)

**Interfaces:**
- Consumes: `ROUTE_MAX_STEPS`(태스크 1)
- Produces:
  - `types.ts`: `type SessionFilter = { kind: "none" } | { kind: "screen"; urlPath: string } | { kind: "feature"; urlPath: string; elementKey: string } | { kind: "path"; start?: string; steps: string[]; exited: boolean }`
  - `parsePeriod(query: unknown, now?: Date): { since: string } | undefined`
  - `parsePathStart(query: unknown): { start?: string } | undefined`
  - `parseSessionFilter(query: unknown): SessionFilter | undefined`
  - 모두 `undefined`면 잘못된 쿼리다.

- [ ] **Step 1: `SessionFilter` 타입을 더한다**

`apps/api/src/store/types.ts`에서 `RankedPath` 바로 뒤에 넣는다.

```ts
/** 세션 목록 필터. 하나만 건다. */
export type SessionFilter =
  | { kind: "none" }
  /** 그 경로의 page_view 가 있는 세션. */
  | { kind: "screen"; urlPath: string }
  /** 그 (url_path, element_key) 의 click 이 있는 세션. */
  | { kind: "feature"; urlPath: string; elementKey: string }
  /** 경로 순위와 같은 규칙으로 잘랐을 때 steps·exited 가 모두 같은 세션. */
  | { kind: "path"; start?: string; steps: string[]; exited: boolean };
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/api/src/routes/aggregation-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePathStart, parsePeriod, parseSessionFilter } from "./aggregation-query.js";

const NOW = new Date("2026-10-10T05:00:00.000Z");

describe("parsePeriod", () => {
  it("days 가 없으면 7일 전이 기준 시각이다", () => {
    expect(parsePeriod({}, NOW)).toEqual({ since: "2026-10-03T05:00:00.000Z" });
  });

  it.each([
    ["1", "2026-10-09T05:00:00.000Z"],
    ["7", "2026-10-03T05:00:00.000Z"],
    ["30", "2026-09-10T05:00:00.000Z"],
  ])("days=%s 의 기준 시각은 %s 다", (days, since) => {
    expect(parsePeriod({ days }, NOW)).toEqual({ since });
  });

  it.each([["2"], ["abc"], [""], [["7", "30"]]])("days=%j 는 잘못된 기간이다", (days) => {
    expect(parsePeriod({ days }, NOW)).toBeUndefined();
  });

  it("다른 쿼리 키는 상관하지 않는다", () => {
    expect(parsePeriod({ days: "1", screen: "/a" }, NOW)).toEqual({ since: "2026-10-09T05:00:00.000Z" });
  });

  it("쿼리가 비어 있어도 기본값을 쓴다", () => {
    expect(parsePeriod(undefined, NOW)).toEqual({ since: "2026-10-03T05:00:00.000Z" });
  });
});

describe("parsePathStart", () => {
  it("start 가 없거나 비었으면 전체다", () => {
    expect(parsePathStart({})).toEqual({});
    expect(parsePathStart({ start: "" })).toEqual({});
  });

  it("start 를 그대로 쓴다", () => {
    expect(parsePathStart({ start: "/quote/:id" })).toEqual({ start: "/quote/:id" });
  });

  it("start 가 둘 이상이면 잘못된 쿼리다", () => {
    expect(parsePathStart({ start: ["/a", "/b"] })).toBeUndefined();
  });
});

describe("parseSessionFilter", () => {
  it("필터 키가 없으면 필터 없음이다", () => {
    expect(parseSessionFilter({ days: "7" })).toEqual({ kind: "none" });
  });

  it("화면 필터", () => {
    expect(parseSessionFilter({ screen: "/quote" })).toEqual({ kind: "screen", urlPath: "/quote" });
  });

  it("기능 필터", () => {
    expect(parseSessionFilter({ featurePath: "/quote", featureKey: "a1b2" })).toEqual({
      kind: "feature",
      urlPath: "/quote",
      elementKey: "a1b2",
    });
  });

  it("경로 필터: step 하나는 문자열로, 여럿은 배열로 온다", () => {
    expect(parseSessionFilter({ step: "/a" })).toEqual({ kind: "path", steps: ["/a"], exited: false });
    expect(parseSessionFilter({ step: ["/a", "/b"], exited: "true", start: "/a" })).toEqual({
      kind: "path",
      start: "/a",
      steps: ["/a", "/b"],
      exited: true,
    });
    expect(parseSessionFilter({ step: "/a", exited: "false" })).toEqual({ kind: "path", steps: ["/a"], exited: false });
  });

  it.each([
    ["화면과 경로를 섞음", { screen: "/a", step: "/a" }],
    ["화면과 기능을 섞음", { screen: "/a", featurePath: "/a", featureKey: "k" }],
    ["featurePath 만", { featurePath: "/a" }],
    ["featureKey 만", { featureKey: "k" }],
    ["start 만", { start: "/a" }],
    ["exited 만", { exited: "true" }],
    ["빈 화면", { screen: "" }],
    ["화면 둘", { screen: ["/a", "/b"] }],
    ["빈 step", { step: ["/a", ""] }],
    ["step 여섯", { step: ["/1", "/2", "/3", "/4", "/5", "/6"] }],
    ["exited 가 true·false 가 아님", { step: "/a", exited: "yes" }],
    ["빈 start", { step: "/a", start: "" }],
    ["start 둘", { step: "/a", start: ["/a", "/b"] }],
  ])("%s 이면 잘못된 필터다", (_label, query) => {
    expect(parseSessionFilter(query)).toBeUndefined();
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run apps/api/src/routes/aggregation-query.test.ts`
Expected: FAIL — `Failed to resolve import "./aggregation-query.js"`

- [ ] **Step 4: 구현한다**

`apps/api/src/routes/aggregation-query.ts`:

```ts
import { z } from "zod";
import { ROUTE_MAX_STEPS } from "../store/route.js";
import type { SessionFilter } from "../store/types.js";

// 집계 API 의 쿼리 파라미터 해석. 잘못된 쿼리는 undefined 로 돌려주고, 라우트가
// 원인별 400 코드로 바꾼다. Fastify 는 같은 키가 반복되면 배열로 준다.

const DAY_MS = 86_400_000;

// 다른 키는 무시한다(z.object 는 모르는 키를 버린다). 세션 API 는 같은 쿼리에 필터 키가 섞여 온다.
const periodSchema = z.object({ days: z.enum(["1", "7", "30"]).default("7") });

type Query = Record<string, unknown>;

/** `days` 를 기준 시각으로 바꾼다. 기준 시각 이후에 시작한 세션이 기간 세션이다. */
export function parsePeriod(query: unknown, now: Date = new Date()): { since: string } | undefined {
  const parsed = periodSchema.safeParse(query ?? {});
  if (!parsed.success) return undefined;
  return { since: new Date(now.getTime() - Number(parsed.data.days) * DAY_MS).toISOString() };
}

/** 이동 흐름의 시작 화면. 없거나 비었으면 "전체"다. */
export function parsePathStart(query: unknown): { start?: string } | undefined {
  const value = asQuery(query).start;
  if (value === undefined || value === "") return {};
  return typeof value === "string" ? { start: value } : undefined;
}

/** 세션 목록 필터. 하나만 걸 수 있다. */
export function parseSessionFilter(query: unknown): SessionFilter | undefined {
  const q = asQuery(query);
  const has = (key: string) => q[key] !== undefined;
  const wantsScreen = has("screen");
  const wantsFeature = has("featurePath") || has("featureKey");
  const wantsPath = has("step") || has("start") || has("exited");
  const groups = [wantsScreen, wantsFeature, wantsPath].filter(Boolean).length;
  if (groups === 0) return { kind: "none" };
  if (groups > 1) return undefined;

  if (wantsScreen) {
    const urlPath = text(q.screen);
    return urlPath === undefined ? undefined : { kind: "screen", urlPath };
  }

  if (wantsFeature) {
    const urlPath = text(q.featurePath);
    const elementKey = text(q.featureKey);
    return urlPath === undefined || elementKey === undefined ? undefined : { kind: "feature", urlPath, elementKey };
  }

  const rawSteps = Array.isArray(q.step) ? q.step : q.step === undefined ? [] : [q.step];
  const steps = rawSteps.map(text);
  // 6개 이상은 어떤 세션과도 맞을 수 없다(경로는 앞 5개까지만 쓴다).
  if (steps.length === 0 || steps.length > ROUTE_MAX_STEPS) return undefined;
  if (steps.some((step) => step === undefined)) return undefined;
  if (q.exited !== undefined && q.exited !== "true" && q.exited !== "false") return undefined;
  const start = has("start") ? text(q.start) : undefined;
  if (has("start") && start === undefined) return undefined;

  return {
    kind: "path",
    ...(start === undefined ? {} : { start }),
    steps: steps as string[],
    exited: q.exited === "true",
  };
}

function asQuery(query: unknown): Query {
  return typeof query === "object" && query !== null ? (query as Query) : {};
}

// 비지 않은 문자열 하나만 값으로 친다. 배열(같은 키 반복)과 빈 문자열은 잘못된 값이다.
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run apps/api/src/routes/aggregation-query.test.ts`
Expected: PASS (30 tests)

- [ ] **Step 6: 전체 확인 후 커밋한다**

```bash
npm run typecheck && npm test 2>&1 | tail -4
git add apps/api/src/routes/aggregation-query.ts apps/api/src/routes/aggregation-query.test.ts apps/api/src/store/types.ts
git commit -q -m "집계: 기간·시작 화면·세션 필터 쿼리를 해석한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 기능 사용 API와 집계 인덱스

**Files:**
- Modify: `apps/api/src/db/schema.sqlite.ts:36-37` (인덱스 교체)
- Create: `apps/api/src/store/analytics-sql.ts`, `apps/api/src/store/analytics.ts`
- Modify: `apps/api/src/store/types.ts`, `apps/api/src/store/sqlite-store.ts`, `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/store/analytics-sql.test.ts`, `apps/api/src/store/analytics.test.ts`, `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `compareText`(태스크 1), `parsePeriod`(태스크 2)
- Produces:
  - `analytics-sql.ts`: `PERIOD_SESSIONS`(CTE 본문 문자열, 모듈 안에서만 씀), `SUMMARY_SQL`, `SCREENS_SQL`, `FEATURES_SQL`, `TITLES_SQL`, `PERIOD_QUERIES: Record<string, string>`. 모든 SQL은 이름 매개변수 `@projectId`, `@since`를 쓴다.
  - `analytics.ts`: `class Analytics { constructor(db: Database.Database); featureUsage(projectId: string, since: string): FeatureUsage; private names(projectId: string, since: string, urlPaths: Iterable<string>): Record<string, string> }`, 상수 `SCREEN_LIMIT = 100`, `FEATURES_PER_SCREEN = 30`, `UNNAMED_FEATURE = "이름 없는 요소"`, `type Row = Record<string, unknown>`
  - `types.ts`: `FeatureUsage`, `ScreenUsage`, `FeatureUsageRow`, `TraceStore.getFeatureUsage(projectId: string, since: string): Promise<FeatureUsage>`
  - 라우트 `GET /admin/api/projects/:projectId/features?days=`

이 태스크의 인덱스와 SQL은 계획을 쓸 때 시험했다. 6개 경로·3개 프로젝트·세션 9천 개·이벤트 9만 개를 넣고 `ANALYZE` 없이 `EXPLAIN QUERY PLAN`을 본 결과다.
- 기존 `(project_id, timestamp)` 인덱스를 두면 기간 세션 후보를 찾을 때 SQLite가 `events_project_session_timestamp (project_id=?)`로 **프로젝트 이벤트 전부를** 훑는다. 세션 2만 개에서 5.9ms 걸렸다.
- `(project_id, timestamp, session_id)`로 바꾸면 `(project_id=? AND timestamp>?)` 범위만 읽는다. `ANALYZE`를 하든 안 하든 같았고, 0.3ms 걸렸다.
- `JOIN period_sessions`를 그냥 쓰면 이벤트 쪽부터 돌며 프로젝트 전체를 훑는다. `period_sessions AS MATERIALIZED`와 `CROSS JOIN`으로 기간 세션에서부터 `(project_id, session_id)`로 찾아가게 고정한다.
- `(project_id, session_id)` 인덱스는 어떤 쿼리도 쓰지 않게 된다. `(project_id, session_id, timestamp)`의 앞부분이라 지운다.

- [ ] **Step 1: 인덱스를 바꾼다**

`apps/api/src/db/schema.sqlite.ts`의 이 두 줄을

```sql
CREATE INDEX IF NOT EXISTS events_project_timestamp ON events (project_id, timestamp);
CREATE INDEX IF NOT EXISTS events_project_session ON events (project_id, session_id);
```

이렇게 바꾼다(`events_project_session_timestamp` 줄은 그대로 둔다).

```sql
-- 기간 세션 후보를 시각 범위로 찾는다. session_id 까지 덮어야 SQLite 가 프로젝트
-- 이벤트 전부를 도는 events_project_session_timestamp 대신 이 인덱스를 고른다.
DROP INDEX IF EXISTS events_project_timestamp;
DROP INDEX IF EXISTS events_project_session;
CREATE INDEX IF NOT EXISTS events_project_timestamp_session ON events (project_id, timestamp, session_id);
```

다른 곳에서 옛 인덱스 이름을 쓰지 않는지 본다.

```bash
grep -rn "events_project_timestamp\b\|events_project_session\b" apps packages --include='*.ts' | grep -v node_modules | grep -v /dist/
```

Expected: `schema.sqlite.ts`의 `DROP INDEX` 두 줄만 나온다.

- [ ] **Step 2: 응답 타입과 저장소 메서드를 선언한다**

`apps/api/src/store/types.ts`에서 `SessionFilter` 바로 뒤에 넣는다.

```ts
/** 기능 사용 화면 응답. */
export interface FeatureUsage {
  summary: {
    /** 기간 세션의 서로 다른 방문자 수. */
    visitors: number;
    /** 기간 세션 수. */
    sessions: number;
    /** 세션마다 마지막 이벤트와 첫 이벤트의 시간 차의 평균(ms). 세션이 없으면 0. */
    averageSessionMs: number;
  };
  /** 방문 수 순, 최대 100개. */
  screens: ScreenUsage[];
}

export interface ScreenUsage {
  urlPath: string;
  /** 기간 세션에서 가장 많이 나온 제목. 없으면 경로. */
  name: string;
  /** page_view 수. 클릭만 있는 경로는 0. */
  views: number;
  visitors: number;
  /** page-stats 와 같은 정의. 짝이 있는 방문이 하나도 없으면 없다 — 0 과 구분한다. */
  averageDwellMs?: number;
  /** 그 화면이 세션의 마지막 page_view 였던 비율. 0~1. */
  exitRate: number;
  /** 클릭 수 순, 최대 30개. */
  features: FeatureUsageRow[];
}

export interface FeatureUsageRow {
  elementKey: string;
  /** 마스킹한 요소 글자. 없으면 역할. */
  name: string;
  role?: string;
  clicks: number;
  visitors: number;
}
```

같은 파일의 `TraceStore` 인터페이스에서 `listPageStats` 줄 바로 뒤에 넣는다.

```ts
  /** since 이후에 시작한 세션의 기능 사용. */
  getFeatureUsage(projectId: string, since: string): Promise<FeatureUsage>;
```

- [ ] **Step 3: 실패하는 저장소 테스트를 쓴다**

`apps/api/src/store/analytics.test.ts`. 이 파일의 맨 위(도우미)는 태스크 4·5도 그대로 쓴다.

```ts
import type { TraceEvent } from "@trace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { elementKey } from "./element-key.js";
import { SqliteStore } from "./sqlite-store.js";

const SINCE = "2026-10-01T00:00:00.000Z";
const ALL_TIME = "1970-01-01T00:00:00.000Z";

/** 기간 안의 시각. T(0) 은 2026-10-02 09:00. */
const T = (minute: number) => new Date(Date.parse("2026-10-02T09:00:00.000Z") + minute * 60_000).toISOString();

type Draft = Omit<TraceEvent, "eventId" | "sessionId" | "pageId" | "metadata">;

const view = (urlPath: string, timestamp: string, titleMasked?: string): Draft => ({
  type: "page_view",
  urlPath,
  timestamp,
  ...(titleMasked === undefined ? {} : { titleMasked }),
});
const leave = (urlPath: string, timestamp: string): Draft => ({ type: "page_leave", urlPath, timestamp });
const click = (urlPath: string, timestamp: string, text?: string, role = "button"): Draft => ({
  type: "click",
  urlPath,
  timestamp,
  elementSelectorHash: `sel_${text ?? role}`,
  elementRole: role,
  ...(text === undefined ? {} : { elementTextMaskedOrLimited: text }),
});
/** click() 이 만든 요소의 elementKey. 저장소가 저장할 때 계산하는 값과 같다. */
const keyOf = (text?: string, role = "button") =>
  elementKey({
    elementSelectorHash: `sel_${text ?? role}`,
    ...(text === undefined ? {} : { elementTextMaskedOrLimited: text }),
  } as TraceEvent)!;

const opened: SqliteStore[] = [];
afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

async function setup() {
  const store = new SqliteStore(":memory:");
  opened.push(store);
  const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
  let counter = 0;
  const save = async (sessionId: string, anonymousUserId: string, drafts: Draft[], projectId = project.projectId) => {
    await store.saveBatch({
      projectId,
      anonymousUserId,
      sessionId,
      sentAt: drafts[0]!.timestamp,
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/",
      events: drafts.map((draft) => ({ ...draft, metadata: {}, eventId: `evt_${++counter}`, sessionId, pageId: "page_1" })),
    });
  };
  return { store, projectId: project.projectId, save };
}

describe("getFeatureUsage", () => {
  it("기간 안에 시작한 세션만 넣고, 넣은 세션은 기준 시각 뒤 이벤트까지 센다", async () => {
    const { store, projectId, save } = await setup();
    // 기준 시각 10분 전에 시작해 기준 시각 뒤까지 이어진 세션은 통째로 빠진다.
    await save("sess_before", "anon_1", [view("/a", "2026-09-30T23:50:00.000Z"), view("/b", "2026-10-01T00:10:00.000Z")]);
    // 기준 시각과 같은 밀리초에 시작한 세션은 넣는다.
    await save("sess_edge", "anon_2", [view("/a", SINCE)]);
    await save("sess_in", "anon_3", [view("/a", "2026-10-01T00:05:00.000Z"), view("/c", "2026-10-02T03:00:00.000Z")]);

    const usage = await store.getFeatureUsage(projectId, SINCE);

    expect(usage.summary.sessions).toBe(2);
    expect(usage.screens.map((screen) => [screen.urlPath, screen.views])).toEqual([
      ["/a", 2],
      ["/c", 1],
    ]);
  });

  it("요약 지표: 방문자, 세션, 평균 세션 길이", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0)), view("/b", T(1))]); // 60초
    await save("s2", "anon_1", [view("/a", T(10)), view("/a", T(10.5))]); // 30초
    await save("s3", "anon_2", [view("/a", T(20))]); // 0초

    const { summary } = await store.getFeatureUsage(projectId, SINCE);

    expect(summary).toEqual({ visitors: 2, sessions: 3, averageSessionMs: 30_000 });
  });

  it("화면 행: 방문·방문자·평균 체류·이탈률", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [
      view("/a", "2026-10-02T09:00:00.000Z"),
      leave("/a", "2026-10-02T09:00:10.000Z"),
      // 라우팅 이동이면 page_leave 와 다음 page_view 가 같은 밀리초를 찍는다.
      view("/b", "2026-10-02T09:00:10.000Z"),
      leave("/b", "2026-10-02T09:00:40.000Z"),
    ]);
    await save("s2", "anon_2", [view("/a", "2026-10-02T10:00:00.000Z")]);

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(screens).toEqual([
      // 체류는 짝이 있는 s1 의 방문만, 이탈은 s2 의 마지막 화면 하나.
      { urlPath: "/a", name: "/a", views: 2, visitors: 2, averageDwellMs: 10_000, exitRate: 0.5, features: [] },
      { urlPath: "/b", name: "/b", views: 1, visitors: 1, averageDwellMs: 30_000, exitRate: 1, features: [] },
    ]);
  });

  it("체류를 잴 짝이 없으면 averageDwellMs 가 없다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0)), view("/b", T(1))]);

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(screens.find((screen) => screen.urlPath === "/a")).not.toHaveProperty("averageDwellMs");
  });

  it("기능 행: 클릭 수와 방문자, 글자가 없으면 역할을 이름으로 쓰고, 선택자 해시가 없는 클릭은 뺀다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [
      view("/a", T(0)),
      click("/a", T(1), "저장"),
      click("/a", T(2), "저장"),
      click("/a", T(3), "취소"),
      click("/a", T(4), undefined, "link"),
      { type: "click", urlPath: "/a", timestamp: T(5) },
    ]);
    await save("s2", "anon_2", [view("/a", T(10)), click("/a", T(11), "저장")]);

    const [screen] = (await store.getFeatureUsage(projectId, SINCE)).screens;

    expect(screen!.features).toHaveLength(3);
    expect(screen!.features[0]).toEqual({ elementKey: keyOf("저장"), name: "저장", role: "button", clicks: 3, visitors: 2 });
    expect(screen!.features).toContainEqual({ elementKey: keyOf("취소"), name: "취소", role: "button", clicks: 1, visitors: 1 });
    expect(screen!.features).toContainEqual({
      elementKey: keyOf(undefined, "link"),
      name: "link",
      role: "link",
      clicks: 1,
      visitors: 1,
    });
  });

  it("클릭만 있고 방문이 없는 경로도 화면 행으로 넣는다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0)), click("/modal", T(1), "확인")]);

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(screens[1]).toEqual({
      urlPath: "/modal",
      name: "/modal",
      views: 0,
      visitors: 0,
      exitRate: 0,
      features: [{ elementKey: keyOf("확인"), name: "확인", role: "button", clicks: 1, visitors: 1 }],
    });
  });

  it("화면 이름: 가장 많이 나온 제목, 같으면 문자열 순으로 앞선 제목, 없으면 경로", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0), "견적"), view("/b", T(1), "나"), view("/c", T(2))]);
    await save("s2", "anon_2", [view("/a", T(10), "견적"), view("/b", T(11), "가")]);
    await save("s3", "anon_3", [view("/a", T(20), "견적 목록")]);

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(Object.fromEntries(screens.map((screen) => [screen.urlPath, screen.name]))).toEqual({
      "/a": "견적",
      "/b": "가",
      "/c": "/c",
    });
  });

  it("다른 프로젝트의 이벤트는 섞지 않는다", async () => {
    const { store, projectId, save } = await setup();
    const other = await store.createProject({ name: "Other", allowedDomains: ["https://other.example.com"] });
    await save("s1", "anon_1", [view("/a", T(0)), click("/a", T(1), "저장")]);
    await save("s_other", "anon_9", [view("/a", T(0)), view("/z", T(1)), click("/a", T(2), "저장")], other.projectId);

    const usage = await store.getFeatureUsage(projectId, SINCE);

    expect(usage.summary).toEqual({ visitors: 1, sessions: 1, averageSessionMs: 60_000 });
    expect(usage.screens.map((screen) => screen.urlPath)).toEqual(["/a"]);
    expect(usage.screens[0]!.features[0]!.clicks).toBe(1);
  });

  it("세션이 없으면 0 과 빈 배열이다", async () => {
    const { store, projectId } = await setup();

    expect(await store.getFeatureUsage(projectId, SINCE)).toEqual({
      summary: { visitors: 0, sessions: 0, averageSessionMs: 0 },
      screens: [],
    });
  });

  it("화면은 100개, 화면당 기능은 30개까지 돌려준다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0)), ...Array.from({ length: 31 }, (_, i) => click("/a", T(1 + i), `버튼${i}`))]);
    await save("s2", "anon_2", Array.from({ length: 101 }, (_, i) => view(`/p${i}`, T(100 + i))));

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(screens).toHaveLength(100);
    expect(screens.find((screen) => screen.urlPath === "/a")!.features).toHaveLength(30);
  });

  it("방문·체류·이탈이 옛 페이지 통계 계산과 같다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [
      view("/home", T(0)),
      leave("/home", T(1)),
      view("/report", T(1)),
      leave("/report", T(3)),
      view("/home", T(4)),
    ]);
    await save("s2", "anon_2", [view("/home", T(10)), view("/report", T(11)), leave("/report", T(12))]);
    await save("s3", "anon_1", [view("/report", T(20)), leave("/report", T(20)), leave("/report", T(21))]);

    const pick = ({
      urlPath,
      views,
      averageDwellMs,
      exitRate,
    }: {
      urlPath: string;
      views: number;
      averageDwellMs?: number | undefined;
      exitRate: number;
    }) => ({
      urlPath,
      views,
      averageDwellMs,
      exitRate,
    });
    const byPath = (a: { urlPath: string }, b: { urlPath: string }) => a.urlPath.localeCompare(b.urlPath);
    const before = (await store.listPageStats(projectId, 50)).map(pick).sort(byPath);
    const after = (await store.getFeatureUsage(projectId, ALL_TIME)).screens.map(pick).sort(byPath);

    expect(after).toEqual(before);
  });
});
```

`apps/api/src/store/analytics-sql.test.ts`:

```ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SQLITE_SCHEMA } from "../db/schema.sqlite.js";
import { PERIOD_QUERIES } from "./analytics-sql.js";

// 쓰지 않는 이름은 better-sqlite3 가 무시한다(빠진 이름은 던진다). 모든 쿼리에 같은 값을 넘긴다.
const PARAMS = {
  projectId: "proj_1",
  since: "2026-10-01T00:00:00.000Z",
  urlPath: "/a",
  elementKey: "k",
  limit: 50,
  sessionIds: "[]",
};

// 통계(ANALYZE)가 없는 실제 DB 와 같은 조건이다. 빈 테이블과 데이터가 든 테이블의 계획이 같은 것을
// 계획을 쓸 때 확인했다.
function planOf(sql: string): string[] {
  const db = new Database(":memory:");
  db.exec(SQLITE_SCHEMA);
  try {
    return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(PARAMS) as Array<{ detail: string }>).map((row) => row.detail);
  } finally {
    db.close();
  }
}

describe("집계 쿼리 계획", () => {
  it.each(Object.entries(PERIOD_QUERIES))("%s: events 를 인덱스 없이 훑지 않는다", (_name, sql) => {
    // events 테이블의 별칭은 events·e·o·l·f 뿐이다. CTE(c, ps, v, s …)를 훑는 것은 괜찮다.
    expect(planOf(sql).filter((detail) => /^SCAN (events|e|o|l|f)\b/.test(detail))).toEqual([]);
  });

  it.each(Object.entries(PERIOD_QUERIES))("%s: 기간 세션 후보를 시각 범위로 찾는다", (_name, sql) => {
    expect(planOf(sql)).toContain(
      "SEARCH events USING COVERING INDEX events_project_timestamp_session (project_id=? AND timestamp>?)",
    );
  });

  it.each(Object.entries(PERIOD_QUERIES))("%s: 이벤트를 기간 세션에서부터 찾아간다", (_name, sql) => {
    // 이벤트 쪽에서 출발하면 (project_id=?) 하나로 프로젝트 전체를 돈다.
    expect(planOf(sql).filter((detail) => /^SEARCH (e|f|l|o) .*\(project_id=\?\)$/.test(detail))).toEqual([]);
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `npx vitest run apps/api/src/store/analytics.test.ts apps/api/src/store/analytics-sql.test.ts`
Expected: FAIL — `Failed to resolve import "./analytics-sql.js"`, `store.getFeatureUsage is not a function`

- [ ] **Step 5: SQL 을 쓴다**

`apps/api/src/store/analytics-sql.ts`:

```ts
// 집계 화면 세 개가 쓰는 SQL. 설계: docs/superpowers/specs/2026-10-10-stage3-1-aggregation-api-design.md
//
// 모든 쿼리는 "기간 세션"(기준 시각 @since 이후에 시작한 세션)에서 출발한다.
// 이벤트는 기간 세션에서부터 (project_id, session_id) 로 찾아간다 — 반대로 이벤트를
// 돌며 기간 세션을 찾으면 프로젝트 이벤트 전부를 훑는다. CROSS JOIN 은 SQLite 에서
// 조인 순서를 고정하는 문법이고, MATERIALIZED 는 기간 세션을 한 번만 계산하게 한다.
// 쿼리 계획은 analytics-sql.test.ts 가 지킨다.

const PERIOD_SESSIONS = `
  candidates AS (
    -- events_project_timestamp_session 인덱스 하나로 끝난다(테이블을 읽지 않는다).
    SELECT DISTINCT session_id FROM events
     WHERE project_id = @projectId AND timestamp >= @since
  ),
  period_sessions AS MATERIALIZED (
    -- 기준 시각 전에도 이벤트가 있으면 그 전에 시작한 세션이다.
    SELECT c.session_id FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM events o
        WHERE o.project_id = @projectId AND o.session_id = c.session_id AND o.timestamp < @since
     )
  )`;

// 시각 차(ms). 차를 먼저 반올림해 정수로 만든다 — julianday 의 부동소수 오차가
// 평균에 쌓이지 않게 한다. Date.parse 로 뺀 값과 같다.
const elapsedMs = (later: string, earlier: string) =>
  `ROUND((julianday(${later}) - julianday(${earlier})) * 86400000.0)`;

export const SUMMARY_SQL = `
  WITH ${PERIOD_SESSIONS},
  per_session AS (
    SELECT e.session_id,
           -- 한 세션은 한 탭에서 오므로 방문자 ID 는 하나다. MIN 은 집계 문법을 맞추려는 것이다.
           MIN(e.anonymous_user_id) AS visitor,
           MIN(e.timestamp) AS started_at,
           MAX(e.timestamp) AS last_seen_at
      FROM period_sessions ps
     CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
     GROUP BY e.session_id
  )
  SELECT COUNT(*) AS sessions,
         COUNT(DISTINCT visitor) AS visitors,
         AVG(${elapsedMs("last_seen_at", "started_at")}) AS average_session_ms
    FROM per_session`;

// 체류와 이탈은 store/page-stats.ts 와 같은 정의다. 다음 page_view 까지(양 끝 포함)
// 사이에서 같은 경로의 가장 이른 page_leave 가 체류의 끝이고, 다음 page_view 가
// 없으면 그 세션의 마지막 화면(이탈)이다. <= 인 이유는 page-stats.ts 주석에 있다.
export const SCREENS_SQL = `
  WITH ${PERIOD_SESSIONS},
  views AS (
    SELECT e.session_id, e.url_path, e.timestamp, e.anonymous_user_id,
           LEAD(e.timestamp) OVER (PARTITION BY e.session_id ORDER BY e.timestamp, e.rowid) AS next_at
      FROM period_sessions ps
     CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
     WHERE e.type = 'page_view'
  ),
  measured AS (
    SELECT v.url_path,
           v.anonymous_user_id,
           v.timestamp AS viewed_at,
           v.next_at IS NULL AS exited,
           (SELECT MIN(l.timestamp) FROM events l
             WHERE l.project_id = @projectId AND l.session_id = v.session_id
               AND l.type = 'page_leave' AND l.url_path = v.url_path
               AND l.timestamp >= v.timestamp
               AND (v.next_at IS NULL OR l.timestamp <= v.next_at)) AS left_at
      FROM views v
  )
  SELECT url_path,
         COUNT(*) AS views,
         COUNT(DISTINCT anonymous_user_id) AS visitors,
         AVG(${elapsedMs("left_at", "viewed_at")}) AS average_dwell_ms,
         SUM(exited) AS exits
    FROM measured
   GROUP BY url_path`;

export const FEATURES_SQL = `
  WITH ${PERIOD_SESSIONS}
  SELECT e.url_path,
         e.element_key,
         -- element_key 가 글자를 포함하므로 한 기능의 글자는 하나다. MAX 는 집계 문법을 맞추려는 것이다.
         MAX(e.element_text_masked_or_limited) AS text,
         MAX(e.element_role) AS role,
         COUNT(*) AS clicks,
         COUNT(DISTINCT e.anonymous_user_id) AS visitors
    FROM period_sessions ps
   CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
   WHERE e.type = 'click' AND e.element_key IS NOT NULL
   GROUP BY e.url_path, e.element_key
   ORDER BY clicks DESC, e.element_key`;

// 경로마다 횟수가 많은 순, 같으면 제목 순(BINARY). 처음 나온 제목이 그 경로의 이름이다.
export const TITLES_SQL = `
  WITH ${PERIOD_SESSIONS}
  SELECT e.url_path, e.title_masked, COUNT(*) AS n
    FROM period_sessions ps
   CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
   WHERE e.type = 'page_view' AND e.title_masked IS NOT NULL AND e.title_masked <> ''
   GROUP BY e.url_path, e.title_masked
   ORDER BY e.url_path, n DESC, e.title_masked`;

/** 기간 세션에서 출발하는 쿼리 전부. analytics-sql.test.ts 가 쿼리 계획을 확인한다. */
export const PERIOD_QUERIES: Record<string, string> = {
  SUMMARY_SQL,
  SCREENS_SQL,
  FEATURES_SQL,
  TITLES_SQL,
};
```

- [ ] **Step 6: `Analytics` 를 쓴다**

`apps/api/src/store/analytics.ts`:

```ts
import type Database from "better-sqlite3";
import { FEATURES_SQL, SCREENS_SQL, SUMMARY_SQL, TITLES_SQL } from "./analytics-sql.js";
import { compareText } from "./route.js";
import type { FeatureUsage, ScreenUsage } from "./types.js";

// 집계 SQL 을 실행해 관리자 화면이 쓰는 응답 모양으로 묶는다. SqliteStore 가 위임한다.

export const SCREEN_LIMIT = 100;
export const FEATURES_PER_SCREEN = 30;
/** 글자도 역할도 없는 요소의 이름. */
export const UNNAMED_FEATURE = "이름 없는 요소";

export type Row = Record<string, unknown>;

export class Analytics {
  constructor(private readonly db: Database.Database) {}

  featureUsage(projectId: string, since: string): FeatureUsage {
    const params = { projectId, since };
    const summary = this.db.prepare(SUMMARY_SQL).get(params) as Row;

    const screens = new Map<string, ScreenUsage>();
    const screenOf = (urlPath: string): ScreenUsage => {
      let screen = screens.get(urlPath);
      if (!screen) {
        // 클릭만 있고 page_view 가 없는 경로(모달 경로 등)도 기능을 보여줄 자리가 있어야 한다.
        screen = { urlPath, name: urlPath, views: 0, visitors: 0, exitRate: 0, features: [] };
        screens.set(urlPath, screen);
      }
      return screen;
    };

    for (const row of this.db.prepare(SCREENS_SQL).all(params) as Row[]) {
      const screen = screenOf(row.url_path as string);
      screen.views = row.views as number;
      screen.visitors = row.visitors as number;
      screen.exitRate = (row.exits as number) / screen.views;
      if (row.average_dwell_ms !== null) screen.averageDwellMs = Math.round(row.average_dwell_ms as number);
    }

    // 클릭 수 순으로 정렬돼 온다.
    for (const row of this.db.prepare(FEATURES_SQL).all(params) as Row[]) {
      const screen = screenOf(row.url_path as string);
      if (screen.features.length >= FEATURES_PER_SCREEN) continue;
      const role = (row.role as string | null) ?? undefined;
      screen.features.push({
        elementKey: row.element_key as string,
        name: (row.text as string | null) ?? role ?? UNNAMED_FEATURE,
        ...(role === undefined ? {} : { role }),
        clicks: row.clicks as number,
        visitors: row.visitors as number,
      });
    }

    const top = [...screens.values()]
      .sort((a, b) => b.views - a.views || compareText(a.urlPath, b.urlPath))
      .slice(0, SCREEN_LIMIT);
    const names = this.names(projectId, since, top.map((screen) => screen.urlPath));
    for (const screen of top) screen.name = names[screen.urlPath]!;

    return {
      summary: {
        visitors: summary.visitors as number,
        sessions: summary.sessions as number,
        averageSessionMs: summary.average_session_ms === null ? 0 : Math.round(summary.average_session_ms as number),
      },
      screens: top,
    };
  }

  /** 경로마다 기간 세션에서 가장 많이 나온 제목. 없으면 경로 그대로. */
  private names(projectId: string, since: string, urlPaths: Iterable<string>): Record<string, string> {
    const titles = new Map<string, string>();
    for (const row of this.db.prepare(TITLES_SQL).all({ projectId, since }) as Row[]) {
      const urlPath = row.url_path as string;
      if (!titles.has(urlPath)) titles.set(urlPath, row.title_masked as string);
    }
    const names: Record<string, string> = {};
    for (const urlPath of urlPaths) names[urlPath] = titles.get(urlPath) ?? urlPath;
    return names;
  }
}
```

- [ ] **Step 7: `SqliteStore` 가 위임한다**

`apps/api/src/store/sqlite-store.ts`:

import 에 더한다.

```ts
import { Analytics } from "./analytics.js";
```

`import type { … } from "./types.js";` 목록에 `FeatureUsage,`를 더한다(가나다순 자리: `CreateProjectInput,` 뒤).

클래스 필드와 생성자를 고친다.

```ts
export class SqliteStore implements TraceStore {
  private readonly db: Database.Database;
  private readonly analytics: Analytics;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    if (filePath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.exec(SQLITE_SCHEMA);
    this.createDebugViews();
    this.analytics = new Analytics(this.db);
  }
```

`listPageStats` 메서드 바로 뒤에 넣는다.

```ts
  async getFeatureUsage(projectId: string, since: string): Promise<FeatureUsage> {
    return this.analytics.featureUsage(projectId, since);
  }
```

- [ ] **Step 8: 저장소 테스트 통과를 확인한다**

Run: `npx vitest run apps/api/src/store/analytics.test.ts apps/api/src/store/analytics-sql.test.ts`
Expected: PASS (11 + 12 tests). 쿼리 계획 테스트가 실패하면 실제 계획(`planOf` 결과)을 출력해 보고하고 멈춘다. 인덱스나 조인 순서를 임의로 바꾸지 않는다.

- [ ] **Step 9: 실패하는 라우트 테스트를 쓴다**

`apps/api/src/routes/admin.test.ts`의 맨 끝(마지막 `});` 뒤)에 붙인다. 이 파일의 `createAuthenticatedOwner`, `createApp`, `createTestStore`, `authConfig`를 쓴다. 맨 위 도우미 두 개는 태스크 4·5의 라우트 테스트도 쓴다.

```ts
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function seedPageView(
  store: ReturnType<typeof createTestStore>,
  projectId: string,
  sessionId: string,
  timestamp: string,
  urlPath = "/a",
) {
  await store.saveBatch({
    projectId,
    anonymousUserId: "anon_1",
    sessionId,
    sentAt: timestamp,
    sdkVersion: "0.1.0",
    url: "https://demo.example.com/",
    events: [{ eventId: `evt_${sessionId}_${urlPath}`, sessionId, pageId: "page_1", timestamp, type: "page_view", urlPath, metadata: {} }],
  });
}

describe("기능 사용 API", () => {
  it("기본 7일, days 로 기간을 바꾼다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_recent", daysAgo(2));
    await seedPageView(store, project.projectId, "sess_old", daysAgo(10));
    const get = (query: string) =>
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/features${query}`, headers });

    const [byDefault, week, month, day] = await Promise.all([get(""), get("?days=7"), get("?days=30"), get("?days=1")]);

    expect(byDefault.statusCode).toBe(200);
    expect(byDefault.headers["cache-control"]).toBe("no-store");
    expect(byDefault.json().summary.sessions).toBe(1);
    expect(week.json().summary.sessions).toBe(1);
    expect(month.json().summary.sessions).toBe(2);
    expect(day.json().summary.sessions).toBe(0);
    expect(month.json().screens[0]).toMatchObject({ urlPath: "/a", name: "/a", views: 2 });
  });

  it.each(["?days=2", "?days=abc", "?days=7&days=30"])("잘못된 기간 %s 는 400 이다", async (query) => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/features${query}`, headers });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_period" });
  });

  it("로그인하지 않으면 401, 없는 프로젝트는 404 다", async () => {
    const { app, headers } = await createAuthenticatedOwner();

    const [anonymous, missing] = await Promise.all([
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/features" }),
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/features", headers }),
    ]);

    expect(anonymous.statusCode).toBe(401);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "project_not_found" });
  });
});
```

Run: `npx vitest run apps/api/src/routes/admin.test.ts`
Expected: FAIL — 새 테스트가 404(라우트 없음)를 받는다.

- [ ] **Step 10: 라우트를 더한다**

`apps/api/src/routes/admin-proxy.ts`의 import 에 더한다.

```ts
import { parsePeriod } from "./aggregation-query.js";
```

`app.get("/admin/api/projects/:projectId/page-stats", …)` 핸들러 바로 앞에 넣는다.

```ts
  app.get("/admin/api/projects/:projectId/features", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const period = parsePeriod(request.query);
    if (!period) return reply.code(400).send({ error: "invalid_period" });
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const usage = await options.store.getFeatureUsage(projectId, period.since);
    return reply.header("cache-control", "no-store").send(usage);
  });
```

- [ ] **Step 11: 통과를 확인한다**

Run: `npx vitest run apps/api/src/routes/admin.test.ts`
Expected: PASS

- [ ] **Step 12: 전체 확인 후 커밋한다**

```bash
npm run typecheck && npm test 2>&1 | tail -4
git add apps/api/src/db/schema.sqlite.ts apps/api/src/store/analytics-sql.ts apps/api/src/store/analytics-sql.test.ts \
  apps/api/src/store/analytics.ts apps/api/src/store/analytics.test.ts apps/api/src/store/types.ts \
  apps/api/src/store/sqlite-store.ts apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.test.ts
git commit -q -m "집계: 기능 사용 API 와 기간 세션 인덱스를 더한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 이동 흐름 API

**Files:**
- Modify: `apps/api/src/store/analytics-sql.ts`, `apps/api/src/store/analytics.ts`, `apps/api/src/store/types.ts`, `apps/api/src/store/sqlite-store.ts`, `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/store/analytics.test.ts`, `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `collapseScreens`, `rankRoutes`, `compareText`(태스크 1), `parsePeriod`, `parsePathStart`(태스크 2), `Analytics`, `Row`, `names()`(태스크 3), 테스트 도우미 `setup`, `save`, `view`, `click`, `T`, `SINCE`(태스크 3), 라우트 테스트 도우미 `daysAgo`, `seedPageView`(태스크 3)
- Produces:
  - `analytics-sql.ts`: `PAGE_VIEWS_SQL`(`session_id`, `url_path`를 `session_id, timestamp, rowid` 순으로)
  - `analytics.ts`: `PATH_LIMIT = 20`, `Analytics.pathRanking(projectId: string, since: string, start?: string): PathRanking`, `private periodScreens(projectId: string, since: string): Map<string, string[]>`, 모듈 함수 `groupScreens(rows: Row[]): Map<string, string[]>`(합친 화면)
  - `types.ts`: `PathRanking`, `TraceStore.getPathRanking(projectId: string, since: string, start?: string): Promise<PathRanking>`
  - 라우트 `GET /admin/api/projects/:projectId/paths?days=&start=`

- [ ] **Step 1: 타입과 저장소 메서드를 선언한다**

`apps/api/src/store/types.ts`에서 `FeatureUsageRow` 바로 뒤에 넣는다.

```ts
/** 이동 흐름 화면 응답. */
export interface PathRanking {
  /** 시작 화면으로 자른 뒤 남은 대상 세션 수. ratio 의 분모다. */
  totalSessions: number;
  /** 세션 수 순, 최대 20개. */
  paths: RankedPath[];
  /** 기간 세션에 나온 모든 경로의 화면 이름. 시작 화면 선택지로도 쓴다. */
  names: Record<string, string>;
}
```

`TraceStore`의 `getFeatureUsage` 줄 바로 뒤에 넣는다.

```ts
  /** since 이후에 시작한 세션의 경로 순위. start 가 없으면 세션의 첫 화면부터 센다. */
  getPathRanking(projectId: string, since: string, start?: string): Promise<PathRanking>;
```

- [ ] **Step 2: 실패하는 저장소 테스트를 쓴다**

`apps/api/src/store/analytics.test.ts`의 맨 끝에 붙인다.

```ts
describe("getPathRanking", () => {
  it("연달아 같은 화면을 합쳐 경로를 세고, 시작 화면으로 자른다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [
      view("/", T(0), "홈"),
      view("/quote", T(1), "견적 목록"),
      view("/quote", T(2), "견적 목록"), // 새로고침
      view("/quote/new", T(3), "견적 등록"),
    ]);
    await save("s2", "anon_2", [view("/", T(10), "홈"), view("/quote", T(11), "견적 목록"), view("/quote/new", T(12), "견적 등록")]);
    await save("s3", "anon_3", [view("/", T(20), "홈"), view("/pay", T(21))]);

    expect(await store.getPathRanking(projectId, SINCE)).toEqual({
      totalSessions: 3,
      paths: [
        { steps: ["/", "/quote", "/quote/new"], exited: true, sessions: 2, ratio: 2 / 3 },
        { steps: ["/", "/pay"], exited: true, sessions: 1, ratio: 1 / 3 },
      ],
      names: { "/": "홈", "/quote": "견적 목록", "/quote/new": "견적 등록", "/pay": "/pay" },
    });

    const fromQuote = await store.getPathRanking(projectId, SINCE, "/quote");

    expect(fromQuote.totalSessions).toBe(2);
    expect(fromQuote.paths).toEqual([{ steps: ["/quote", "/quote/new"], exited: true, sessions: 2, ratio: 1 }]);
  });

  it("같은 밀리초의 page_view 는 저장한 순서로 놓는다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/b", T(0)), view("/a", T(0))]);

    const { paths } = await store.getPathRanking(projectId, SINCE);

    expect(paths.map((path) => path.steps)).toEqual([["/b", "/a"]]);
  });

  it("page_view 가 없는 세션은 경로 대상에서 빠진다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [click("/a", T(0), "저장")]);
    await save("s2", "anon_2", [view("/a", T(10))]);

    const ranking = await store.getPathRanking(projectId, SINCE);

    expect(ranking.totalSessions).toBe(1);
    expect(ranking.paths).toEqual([{ steps: ["/a"], exited: true, sessions: 1, ratio: 1 }]);
  });

  it("기간 전에 시작한 세션은 빠진다", async () => {
    const { store, projectId, save } = await setup();
    await save("s_old", "anon_1", [view("/old", "2026-09-30T23:59:00.000Z"), view("/a", "2026-10-01T00:01:00.000Z")]);
    await save("s1", "anon_2", [view("/a", T(0))]);

    const ranking = await store.getPathRanking(projectId, SINCE);

    expect(ranking.totalSessions).toBe(1);
    expect(ranking.names).toEqual({ "/a": "/a" });
  });

  it("시작 화면이 어느 세션에도 없으면 비어 있다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0))]);

    expect(await store.getPathRanking(projectId, SINCE, "/zzz")).toEqual({
      totalSessions: 0,
      paths: [],
      names: { "/a": "/a" },
    });
  });

  it("경로는 20개까지 돌려준다", async () => {
    const { store, projectId, save } = await setup();
    for (let i = 0; i < 21; i++) await save(`s${i}`, `anon_${i}`, [view(`/p${String(i).padStart(2, "0")}`, T(i))]);

    const ranking = await store.getPathRanking(projectId, SINCE);

    expect(ranking.totalSessions).toBe(21);
    expect(ranking.paths).toHaveLength(20);
  });
});
```

Run: `npx vitest run apps/api/src/store/analytics.test.ts`
Expected: FAIL — `store.getPathRanking is not a function`

- [ ] **Step 3: SQL 을 더한다**

`apps/api/src/store/analytics-sql.ts`에서 `TITLES_SQL` 바로 뒤에 넣는다.

```ts
// 경로 계산에 쓰는 page_view 세 열. 같은 밀리초면 저장한 순서(rowid)로 놓는다.
// 클릭·스크롤은 읽지 않는다.
export const PAGE_VIEWS_SQL = `
  WITH ${PERIOD_SESSIONS}
  SELECT e.session_id, e.url_path
    FROM period_sessions ps
   CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
   WHERE e.type = 'page_view'
   ORDER BY e.session_id, e.timestamp, e.rowid`;
```

`PERIOD_QUERIES`에 `PAGE_VIEWS_SQL,`을 더한다.

```ts
export const PERIOD_QUERIES: Record<string, string> = {
  SUMMARY_SQL,
  SCREENS_SQL,
  FEATURES_SQL,
  TITLES_SQL,
  PAGE_VIEWS_SQL,
};
```

- [ ] **Step 4: `Analytics` 에 경로 순위를 더한다**

`apps/api/src/store/analytics.ts`의 import 를 고친다.

```ts
import type Database from "better-sqlite3";
import { FEATURES_SQL, PAGE_VIEWS_SQL, SCREENS_SQL, SUMMARY_SQL, TITLES_SQL } from "./analytics-sql.js";
import { collapseScreens, compareText, rankRoutes } from "./route.js";
import type { FeatureUsage, PathRanking, ScreenUsage } from "./types.js";
```

상수 `FEATURES_PER_SCREEN` 줄 바로 뒤에 넣는다.

```ts
export const PATH_LIMIT = 20;
```

`featureUsage` 메서드 바로 뒤(`names` 앞)에 넣는다.

```ts
  pathRanking(projectId: string, since: string, start?: string): PathRanking {
    const screensBySession = this.periodScreens(projectId, since);
    const { totalSessions, paths } = rankRoutes(screensBySession.values(), start, PATH_LIMIT);
    const seen = new Set<string>();
    for (const screens of screensBySession.values()) for (const screen of screens) seen.add(screen);
    return { totalSessions, paths, names: this.names(projectId, since, [...seen].sort(compareText)) };
  }

  /** 기간 세션마다 합친 화면 배열. page_view 가 없는 세션은 들어가지 않는다. */
  private periodScreens(projectId: string, since: string): Map<string, string[]> {
    return groupScreens(this.db.prepare(PAGE_VIEWS_SQL).all({ projectId, since }) as Row[]);
  }
```

파일 맨 끝(클래스 밖)에 넣는다.

```ts
/** session_id 순으로 정렬된 page_view 행을 세션마다 묶어 연달아 같은 화면을 합친다. */
export function groupScreens(rows: Row[]): Map<string, string[]> {
  const raw = new Map<string, string[]>();
  for (const row of rows) {
    const sessionId = row.session_id as string;
    const urlPath = row.url_path as string;
    const list = raw.get(sessionId);
    if (list) list.push(urlPath);
    else raw.set(sessionId, [urlPath]);
  }
  return new Map([...raw].map(([sessionId, urlPaths]) => [sessionId, collapseScreens(urlPaths)]));
}
```

- [ ] **Step 5: `SqliteStore` 가 위임한다**

`apps/api/src/store/sqlite-store.ts`의 `import type { … } from "./types.js";` 목록에 `PathRanking,`을 더하고(`PageStats,` 뒤), `getFeatureUsage` 메서드 바로 뒤에 넣는다.

```ts
  async getPathRanking(projectId: string, since: string, start?: string): Promise<PathRanking> {
    return this.analytics.pathRanking(projectId, since, start);
  }
```

Run: `npx vitest run apps/api/src/store/analytics.test.ts apps/api/src/store/analytics-sql.test.ts`
Expected: PASS. `PAGE_VIEWS_SQL`의 계획 테스트 세 개도 통과한다.

- [ ] **Step 6: 실패하는 라우트 테스트를 쓴다**

`apps/api/src/routes/admin.test.ts`의 맨 끝에 붙인다.

```ts
describe("이동 흐름 API", () => {
  it("기간과 시작 화면으로 경로 순위를 돌려준다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_1", daysAgo(1), "/a");
    await seedPageView(store, project.projectId, "sess_1", daysAgo(0.99), "/b");
    await seedPageView(store, project.projectId, "sess_2", daysAgo(2), "/b");
    await seedPageView(store, project.projectId, "sess_old", daysAgo(10), "/a");
    const get = (query: string) =>
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/paths${query}`, headers });

    const [all, fromB, emptyStart] = await Promise.all([get(""), get("?start=%2Fb"), get("?start=")]);

    expect(all.statusCode).toBe(200);
    expect(all.headers["cache-control"]).toBe("no-store");
    expect(all.json()).toEqual({
      totalSessions: 2,
      paths: [
        { steps: ["/a", "/b"], exited: true, sessions: 1, ratio: 0.5 },
        { steps: ["/b"], exited: true, sessions: 1, ratio: 0.5 },
      ],
      names: { "/a": "/a", "/b": "/b" },
    });
    expect(fromB.json().paths).toEqual([{ steps: ["/b"], exited: true, sessions: 2, ratio: 1 }]);
    expect(emptyStart.json()).toEqual(all.json());
  });

  it("잘못된 기간은 invalid_period, start 가 둘이면 invalid_path_start 다", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();
    const get = (query: string) =>
      app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/paths${query}`, headers });

    const [badDays, twoStarts] = await Promise.all([get("?days=2"), get("?start=%2Fa&start=%2Fb")]);

    expect(badDays.statusCode).toBe(400);
    expect(badDays.json()).toEqual({ error: "invalid_period" });
    expect(twoStarts.statusCode).toBe(400);
    expect(twoStarts.json()).toEqual({ error: "invalid_path_start" });
  });

  it("로그인하지 않으면 401, 없는 프로젝트는 404 다", async () => {
    const { app, headers } = await createAuthenticatedOwner();

    const [anonymous, missing] = await Promise.all([
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/paths" }),
      app.inject({ method: "GET", url: "/admin/api/projects/proj_missing/paths", headers }),
    ]);

    expect(anonymous.statusCode).toBe(401);
    expect(missing.statusCode).toBe(404);
  });
});
```

Run: `npx vitest run apps/api/src/routes/admin.test.ts`
Expected: FAIL — 새 테스트가 404 를 받는다.

- [ ] **Step 7: 라우트를 더한다**

`apps/api/src/routes/admin-proxy.ts`의 import 를 고친다.

```ts
import { parsePathStart, parsePeriod } from "./aggregation-query.js";
```

`features` 핸들러 바로 뒤에 넣는다.

```ts
  app.get("/admin/api/projects/:projectId/paths", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const period = parsePeriod(request.query);
    if (!period) return reply.code(400).send({ error: "invalid_period" });
    const path = parsePathStart(request.query);
    if (!path) return reply.code(400).send({ error: "invalid_path_start" });
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const ranking = await options.store.getPathRanking(projectId, period.since, path.start);
    return reply.header("cache-control", "no-store").send(ranking);
  });
```

- [ ] **Step 8: 통과 확인 후 커밋한다**

```bash
npx vitest run apps/api/src/routes/admin.test.ts
npm run typecheck && npm test 2>&1 | tail -4
git add apps/api/src/store/analytics-sql.ts apps/api/src/store/analytics.ts apps/api/src/store/analytics.test.ts \
  apps/api/src/store/types.ts apps/api/src/store/sqlite-store.ts apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.test.ts
git commit -q -m "집계: 이동 흐름 API 로 많이 다닌 경로를 센다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 세션 목록에 기간과 필터를 더한다

**Files:**
- Modify: `apps/api/src/store/analytics-sql.ts`, `apps/api/src/store/analytics.ts`, `apps/api/src/store/types.ts`, `apps/api/src/store/sqlite-store.ts`, `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/store/analytics.test.ts`, `apps/api/src/store/analytics-sql.test.ts`, `apps/api/src/store/store-contract.test.ts`, `apps/api/src/routes/ingestion.test.ts`, `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `toRoute`, `sameRoute`, `ROUTE_MAX_STEPS`(태스크 1), `parsePeriod`, `parseSessionFilter`, `SessionFilter`(태스크 2), `Analytics`, `names()`(태스크 3), `periodScreens()`, `groupScreens`(태스크 4), 테스트 도우미(태스크 3), 같은 파일 안의 `planOf`(태스크 3의 `analytics-sql.test.ts`)
- Produces:
  - `analytics-sql.ts`: `SESSIONS_SQL: Record<SessionFilter["kind"], string>`(`path`는 `@sessionIds` JSON 배열로 거른다), `PAGE_VIEWS_OF_SQL`(`@projectId`, `@sessionIds`)
  - `analytics.ts`: `Analytics.sessions(projectId: string, query: SessionListQuery): SessionList`
  - `types.ts`: `SessionSummary`에 `durationMs`, `screenCount`, `screens` 추가. `SessionListQuery { since: string; filter: SessionFilter; limit: number }`, `SessionList { total: number; sessions: SessionSummary[]; names: Record<string, string> }`. `TraceStore.listSessions(projectId: string, query: SessionListQuery): Promise<SessionList>`
  - 라우트 `GET /admin/api/projects/:projectId/sessions?days=&screen=|featurePath=&featureKey=|step=&exited=&start=` 응답 `{ total, sessions, names }`

- [ ] **Step 1: 타입을 바꾼다**

`apps/api/src/store/types.ts`의 `SessionSummary`를 이렇게 바꾼다.

```ts
/** 한 세션을 요약한 값. 세션 목록 화면이 쓴다. 기록이 없는 세션도 들어간다. */
export interface SessionSummary {
  sessionId: string;
  /** 이 세션을 만든 브라우저의 익명 방문자 ID(`anon_…`). */
  anonymousUserId: string;
  /** 가장 이른 이벤트의 timestamp. 브라우저 시계가 적은 값이라 표시용이다. */
  startedAt: string;
  /** 가장 늦은 이벤트의 timestamp. */
  lastSeenAt: string;
  /** lastSeenAt − startedAt (ms). */
  durationMs: number;
  eventCount: number;
  /** 연달아 나온 같은 화면을 합친 화면 수. page_view 가 없으면 0. */
  screenCount: number;
  /** 합친 화면의 앞 5개. screenCount 가 5 이하면 화면이 끝에 "이탈"을 붙인다. */
  screens: string[];
  /** 이 세션에 리플레이 기록이 올라와 있는지. 재생 버튼을 띄울지 가른다. */
  hasRecording: boolean;
}
```

`PathRanking` 바로 뒤에 넣는다.

```ts
export interface SessionListQuery {
  /** 이 시각 이후에 시작한 세션만. */
  since: string;
  filter: SessionFilter;
  limit: number;
}

/** 세션 목록 응답. */
export interface SessionList {
  /** 조건에 맞는 전체 세션 수. sessions 는 그중 최근 limit 개다. */
  total: number;
  /** 시작 시각 최근 순, 같으면 sessionId 순. */
  sessions: SessionSummary[];
  /** sessions 의 screens 에 나온 경로의 화면 이름. */
  names: Record<string, string>;
}
```

`TraceStore`의 `listSessions` 줄을 바꾼다.

```ts
  listSessions(projectId: string, query: SessionListQuery): Promise<SessionList>;
```

- [ ] **Step 2: 실패하는 저장소 테스트를 쓴다**

`apps/api/src/store/analytics.test.ts`의 import 에 타입을 더한다.

```ts
import type { SessionFilter } from "./types.js";
```

파일 맨 끝에 붙인다.

```ts
describe("listSessions", () => {
  const query = (filter: SessionFilter = { kind: "none" }, limit = 50) => ({ since: SINCE, filter, limit });

  async function seedSessions() {
    const fixture = await setup();
    const { store, projectId, save } = fixture;
    await save("s_old", "anon_0", [view("/", "2026-09-30T23:00:00.000Z", "홈")]);
    await save("s1", "anon_1", [
      view("/", T(0), "홈"),
      view("/quote", T(1), "견적 목록"),
      click("/quote", T(2), "신규 등록"),
      view("/quote/new", T(3)),
    ]);
    await store.saveSessionRecordingChunk({
      sessionId: "s1",
      projectId,
      seq: 0,
      startedAt: T(0),
      receivedAt: T(0),
      eventCount: 1,
      bytes: new Uint8Array([1]),
    });
    await save("s2", "anon_2", [
      view("/", T(10), "홈"),
      view("/quote", T(11)),
      view("/quote", T(12)), // 새로고침
      click("/quote", T(13), "검색"),
    ]);
    await save("s3", "anon_3", ["/pay", "/1", "/2", "/3", "/4", "/5"].map((urlPath, i) => view(urlPath, T(20 + i))));
    return fixture;
  }

  it("필터가 없으면 기간 세션 전부를 최근 순으로 요약한다", async () => {
    const { store, projectId } = await seedSessions();

    const list = await store.listSessions(projectId, query());

    expect(list.total).toBe(3);
    expect(list.sessions.map((session) => session.sessionId)).toEqual(["s3", "s2", "s1"]);
    expect(list.sessions[2]).toEqual({
      sessionId: "s1",
      anonymousUserId: "anon_1",
      startedAt: T(0),
      lastSeenAt: T(3),
      durationMs: 180_000,
      eventCount: 4,
      screenCount: 3,
      screens: ["/", "/quote", "/quote/new"],
      hasRecording: true,
    });
    expect(list.sessions[1]).toMatchObject({ screenCount: 2, screens: ["/", "/quote"], hasRecording: false });
    // 6개 화면 중 앞 5개만 싣는다.
    expect(list.sessions[0]).toMatchObject({ screenCount: 6, screens: ["/pay", "/1", "/2", "/3", "/4"] });
    // 실은 화면의 이름만 준다("/5" 는 없다).
    expect(list.names).toEqual({
      "/": "홈",
      "/quote": "견적 목록",
      "/quote/new": "/quote/new",
      "/pay": "/pay",
      "/1": "/1",
      "/2": "/2",
      "/3": "/3",
      "/4": "/4",
    });
  });

  it("화면 필터: 그 화면을 연 세션", async () => {
    const { store, projectId } = await seedSessions();

    const list = await store.listSessions(projectId, query({ kind: "screen", urlPath: "/quote" }));

    expect(list.total).toBe(2);
    expect(list.sessions.map((session) => session.sessionId)).toEqual(["s2", "s1"]);
  });

  it("기능 필터: 그 기능을 누른 세션", async () => {
    const { store, projectId } = await seedSessions();

    const list = await store.listSessions(
      projectId,
      query({ kind: "feature", urlPath: "/quote", elementKey: keyOf("신규 등록") }),
    );

    expect(list.sessions.map((session) => session.sessionId)).toEqual(["s1"]);
  });

  it("경로 필터: 경로 순위와 같은 규칙으로 자른 경로가 같은 세션", async () => {
    const { store, projectId } = await seedSessions();

    const fromStart = await store.listSessions(projectId, query({ kind: "path", steps: ["/", "/quote"], exited: true }));
    const fromQuote = await store.listSessions(
      projectId,
      query({ kind: "path", start: "/quote", steps: ["/quote"], exited: true }),
    );
    const notExited = await store.listSessions(
      projectId,
      query({ kind: "path", steps: ["/pay", "/1", "/2", "/3", "/4"], exited: false }),
    );

    expect(fromStart.sessions.map((session) => session.sessionId)).toEqual(["s2"]);
    expect(fromQuote.sessions.map((session) => session.sessionId)).toEqual(["s2"]);
    expect(notExited.sessions.map((session) => session.sessionId)).toEqual(["s3"]);
  });

  it("경로 순위의 세션 수와 그 경로로 거른 세션 목록의 total 이 같다", async () => {
    const { store, projectId } = await seedSessions();

    for (const start of [undefined, "/", "/quote"]) {
      const ranking = await store.getPathRanking(projectId, SINCE, start);
      for (const path of ranking.paths) {
        const list = await store.listSessions(
          projectId,
          query({ kind: "path", ...(start === undefined ? {} : { start }), steps: path.steps, exited: path.exited }),
        );
        expect(list.total).toBe(path.sessions);
      }
    }
  });

  it("limit 개만 싣고 total 은 전체 수다", async () => {
    const { store, projectId } = await seedSessions();

    const list = await store.listSessions(projectId, query({ kind: "none" }, 2));

    expect(list.total).toBe(3);
    expect(list.sessions.map((session) => session.sessionId)).toEqual(["s3", "s2"]);
  });

  it("시작 시각이 같으면 sessionId 순이다", async () => {
    const { store, projectId, save } = await setup();
    await save("sess_b", "anon_1", [view("/a", T(0))]);
    await save("sess_a", "anon_2", [view("/a", T(0))]);

    const list = await store.listSessions(projectId, query());

    expect(list.sessions.map((session) => session.sessionId)).toEqual(["sess_a", "sess_b"]);
  });

  it("page_view 가 없는 세션은 화면 0개로 나온다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [click("/a", T(0), "저장")]);

    const list = await store.listSessions(projectId, query());

    expect(list.sessions[0]).toMatchObject({ sessionId: "s1", screenCount: 0, screens: [] });
    expect(list.names).toEqual({});
  });

  it("맞는 세션이 없으면 0 과 빈 배열이다", async () => {
    const { store, projectId } = await seedSessions();

    expect(await store.listSessions(projectId, query({ kind: "screen", urlPath: "/none" }))).toEqual({
      total: 0,
      sessions: [],
      names: {},
    });
    expect(await store.listSessions(projectId, query({ kind: "path", steps: ["/none"], exited: true }))).toEqual({
      total: 0,
      sessions: [],
      names: {},
    });
  });
});
```

`apps/api/src/store/analytics-sql.test.ts`의 import 를 고치고

```ts
import { PAGE_VIEWS_OF_SQL, PERIOD_QUERIES } from "./analytics-sql.js";
```

`describe("집계 쿼리 계획", …)` 블록 안 맨 끝에 넣는다.

```ts
  it("PAGE_VIEWS_OF_SQL: 고른 세션만 인덱스로 찾는다", () => {
    expect(planOf(PAGE_VIEWS_OF_SQL).filter((detail) => /^SCAN (events|e)\b/.test(detail))).toEqual([]);
  });
```

Run: `npx vitest run apps/api/src/store/analytics.test.ts apps/api/src/store/analytics-sql.test.ts`
Expected: FAIL — vitest 는 타입을 보지 않는다. 옛 `listSessions(projectId, limit)`이 객체를 `LIMIT` 값으로 받아 SQLite 바인딩 오류로 던지고, `analytics-sql.test.ts`는 `PAGE_VIEWS_OF_SQL`이 없어 계획 테스트가 실패한다.

- [ ] **Step 3: SQL 을 더한다**

`apps/api/src/store/analytics-sql.ts`의 맨 위(주석 뒤)에 import 를 넣는다.

```ts
import type { SessionFilter } from "./types.js";
```

`PAGE_VIEWS_SQL` 바로 뒤에 넣는다.

```ts
// 세션 목록. matched 는 필터를 건 기간 세션이고, total 은 LIMIT 전에 센다
// (화면이 "180개 중 최근 50개"를 쓴다).
function sessionsSql(condition: string): string {
  return `
  WITH ${PERIOD_SESSIONS},
  matched AS (
    SELECT ps.session_id FROM period_sessions ps ${condition}
  ),
  summary AS (
    SELECT e.session_id,
           MIN(e.timestamp) AS started_at,
           MAX(e.timestamp) AS last_seen_at,
           -- 한 세션은 한 탭에서 오므로 방문자 ID 는 하나다. MIN 은 집계 문법을 맞추려는 것이다.
           MIN(e.anonymous_user_id) AS anonymous_user_id,
           COUNT(*) AS event_count
      FROM matched m
     CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = m.session_id
     GROUP BY e.session_id
  )
  SELECT s.session_id, s.started_at, s.last_seen_at, s.anonymous_user_id, s.event_count,
         ${elapsedMs("s.last_seen_at", "s.started_at")} AS duration_ms,
         COUNT(*) OVER () AS total,
         EXISTS (SELECT 1 FROM session_recordings r
                  WHERE r.project_id = @projectId AND r.session_id = s.session_id) AS has_recording
    FROM summary s
   ORDER BY s.started_at DESC, s.session_id
   LIMIT @limit`;
}

export const SESSIONS_SQL: Record<SessionFilter["kind"], string> = {
  none: sessionsSql(""),
  screen: sessionsSql(`
     WHERE EXISTS (SELECT 1 FROM events f
                    WHERE f.project_id = @projectId AND f.session_id = ps.session_id
                      AND f.type = 'page_view' AND f.url_path = @urlPath)`),
  feature: sessionsSql(`
     WHERE EXISTS (SELECT 1 FROM events f
                    WHERE f.project_id = @projectId AND f.session_id = ps.session_id
                      AND f.type = 'click' AND f.url_path = @urlPath AND f.element_key = @elementKey)`),
  // 경로 필터는 TypeScript(route.ts)가 고른 세션 ID 를 JSON 배열로 받는다.
  path: sessionsSql(`
     WHERE ps.session_id IN (SELECT value FROM json_each(@sessionIds))`),
};

// 목록에 실은 세션들의 page_view. 지나간 화면을 채운다.
export const PAGE_VIEWS_OF_SQL = `
  SELECT e.session_id, e.url_path
    FROM events e
   WHERE e.project_id = @projectId AND e.type = 'page_view'
     AND e.session_id IN (SELECT value FROM json_each(@sessionIds))
   ORDER BY e.session_id, e.timestamp, e.rowid`;
```

`PERIOD_QUERIES`를 바꾼다.

```ts
export const PERIOD_QUERIES: Record<string, string> = {
  SUMMARY_SQL,
  SCREENS_SQL,
  FEATURES_SQL,
  TITLES_SQL,
  PAGE_VIEWS_SQL,
  "SESSIONS_SQL.none": SESSIONS_SQL.none,
  "SESSIONS_SQL.screen": SESSIONS_SQL.screen,
  "SESSIONS_SQL.feature": SESSIONS_SQL.feature,
  "SESSIONS_SQL.path": SESSIONS_SQL.path,
};
```

- [ ] **Step 4: `Analytics` 에 세션 목록을 더한다**

`apps/api/src/store/analytics.ts`의 import 를 고친다.

```ts
import type Database from "better-sqlite3";
import {
  FEATURES_SQL,
  PAGE_VIEWS_OF_SQL,
  PAGE_VIEWS_SQL,
  SCREENS_SQL,
  SESSIONS_SQL,
  SUMMARY_SQL,
  TITLES_SQL,
} from "./analytics-sql.js";
import { collapseScreens, compareText, rankRoutes, ROUTE_MAX_STEPS, sameRoute, toRoute } from "./route.js";
import type {
  FeatureUsage,
  PathRanking,
  ScreenUsage,
  SessionFilter,
  SessionList,
  SessionListQuery,
  SessionSummary,
} from "./types.js";
```

`pathRanking` 메서드 바로 뒤에 넣는다.

```ts
  sessions(projectId: string, query: SessionListQuery): SessionList {
    const { since, filter, limit } = query;
    const params: Record<string, unknown> = { projectId, since, limit };
    const sql = this.sessionsSql(projectId, since, filter, params);
    const rows = this.db.prepare(sql).all(params) as Row[];

    const screensBySession = groupScreens(
      this.db
        .prepare(PAGE_VIEWS_OF_SQL)
        .all({ projectId, sessionIds: JSON.stringify(rows.map((row) => row.session_id)) }) as Row[],
    );
    const shown = new Set<string>();
    const sessions = rows.map((row): SessionSummary => {
      const sessionId = row.session_id as string;
      const all = screensBySession.get(sessionId) ?? [];
      const screens = all.slice(0, ROUTE_MAX_STEPS);
      for (const screen of screens) shown.add(screen);
      return {
        sessionId,
        anonymousUserId: row.anonymous_user_id as string,
        startedAt: row.started_at as string,
        lastSeenAt: row.last_seen_at as string,
        durationMs: row.duration_ms as number,
        eventCount: row.event_count as number,
        screenCount: all.length,
        screens,
        hasRecording: (row.has_recording as number) === 1,
      };
    });

    return {
      total: (rows[0]?.total as number | undefined) ?? 0,
      sessions,
      names: this.names(projectId, since, [...shown].sort(compareText)),
    };
  }

  /** 필터에 맞는 SQL 을 고르고 필요한 매개변수를 params 에 채운다. */
  private sessionsSql(projectId: string, since: string, filter: SessionFilter, params: Record<string, unknown>): string {
    switch (filter.kind) {
      case "none":
        return SESSIONS_SQL.none;
      case "screen":
        params.urlPath = filter.urlPath;
        return SESSIONS_SQL.screen;
      case "feature":
        params.urlPath = filter.urlPath;
        params.elementKey = filter.elementKey;
        return SESSIONS_SQL.feature;
      case "path": {
        // 경로 순위와 같은 함수로 자른다. 그래야 순위의 세션 수와 이 목록의 total 이 같다.
        const wanted = { steps: filter.steps, exited: filter.exited };
        const matched: string[] = [];
        for (const [sessionId, screens] of this.periodScreens(projectId, since)) {
          const route = toRoute(screens, filter.start);
          if (route && sameRoute(route, wanted)) matched.push(sessionId);
        }
        params.sessionIds = JSON.stringify(matched);
        return SESSIONS_SQL.path;
      }
    }
  }
```

- [ ] **Step 5: `SqliteStore` 의 `listSessions` 를 바꾼다**

`apps/api/src/store/sqlite-store.ts`:

- `import type { … } from "./types.js";` 목록에 `SessionList,`와 `SessionListQuery,`를 더한다(`SessionSummary,` 앞). `SessionSummary,`는 더 쓰지 않으면 지운다(`npm run typecheck`가 알려준다).
- 기존 `async listSessions(projectId: string, limit: number): Promise<SessionSummary[]> { … }` 메서드 전체(주석 "세션 테이블이 따로 없다…"부터 `return rows.map(…)`과 닫는 `}`까지)를 지우고 이것으로 바꾼다.

```ts
  async listSessions(projectId: string, query: SessionListQuery): Promise<SessionList> {
    return this.analytics.sessions(projectId, query);
  }
```

Run: `npx vitest run apps/api/src/store/analytics.test.ts apps/api/src/store/analytics-sql.test.ts`
Expected: PASS

- [ ] **Step 6: 옛 호출부를 새 시그니처로 고친다**

`apps/api/src/store/store-contract.test.ts`:

"모든 세션을 최근 순으로 집계하고 기록 유무를 알려준다"에서

```ts
      const sessions = await store.listSessions(project.projectId, 50);
```

를

```ts
      const { sessions } = await store.listSessions(project.projectId, {
        since: "1970-01-01T00:00:00.000Z",
        filter: { kind: "none" },
        limit: 50,
      });
```

로 바꾸고, 같은 테스트의 두 `toEqual` 객체에 필드를 더한다(이 테스트의 이벤트는 모두 클릭이라 화면이 없다).

```ts
      expect(sessions[0]).toEqual({
        sessionId: "sess_new",
        anonymousUserId: "anon_1",
        startedAt: "2026-09-15T01:00:00.000Z",
        lastSeenAt: "2026-09-15T01:00:00.000Z",
        durationMs: 0,
        eventCount: 1,
        screenCount: 0,
        screens: [],
        hasRecording: true,
      });
      expect(sessions[1]).toEqual({
        sessionId: "sess_old",
        anonymousUserId: "anon_1",
        startedAt: "2026-09-15T00:00:00.000Z",
        lastSeenAt: "2026-09-15T00:01:00.000Z",
        durationMs: 60_000,
        eventCount: 2,
        screenCount: 0,
        screens: [],
        hasRecording: false,
      });
```

"세션의 방문자 ID 를 돌려준다"에서

```ts
      const [session] = await store.listSessions(project.projectId, 10);
```

를

```ts
      const {
        sessions: [session],
      } = await store.listSessions(project.projectId, { since: "1970-01-01T00:00:00.000Z", filter: { kind: "none" }, limit: 10 });
```

로 바꾼다.

"다른 프로젝트의 세션은 섞이지 않는다"에서

```ts
      expect((await store.listSessions(a.projectId, 50)).map((s) => s.sessionId)).toEqual(["sess_a"]);
```

를

```ts
      const { sessions } = await store.listSessions(a.projectId, {
        since: "1970-01-01T00:00:00.000Z",
        filter: { kind: "none" },
        limit: 50,
      });
      expect(sessions.map((s) => s.sessionId)).toEqual(["sess_a"]);
```

로 바꾼다.

`apps/api/src/routes/ingestion.test.ts`의

```ts
    const [session] = await store.listSessions(project.projectId, 10);
```

를

```ts
    const {
      sessions: [session],
    } = await store.listSessions(project.projectId, { since: "1970-01-01T00:00:00.000Z", filter: { kind: "none" }, limit: 10 });
```

로 바꾼다.

- [ ] **Step 7: 실패하는 라우트 테스트를 쓴다**

`apps/api/src/routes/admin.test.ts`의 맨 끝에 붙인다.

```ts
describe("세션 목록 API", () => {
  it("기본 7일 안에 시작한 세션을 total·names 와 함께 돌려주고 옛 필드를 지킨다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_recent", daysAgo(2));
    await seedPageView(store, project.projectId, "sess_old", daysAgo(10));

    const response = await app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/sessions`, headers });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.names).toEqual({ "/a": "/a" });
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      sessionId: "sess_recent",
      eventCount: 1,
      hasRecording: false,
      screenCount: 1,
      screens: ["/a"],
    });
    expect(body.sessions[0]).toHaveProperty("startedAt");
    expect(body.sessions[0]).toHaveProperty("lastSeenAt");
  });

  it("인코딩한 경로 필터로 세션을 거른다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_1", daysAgo(1), "/quote/:id");
    await seedPageView(store, project.projectId, "sess_1", daysAgo(0.99), "/견적");
    await seedPageView(store, project.projectId, "sess_2", daysAgo(1), "/quote/:id");
    const step = (value: string) => `step=${encodeURIComponent(value)}`;

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/sessions?${step("/quote/:id")}&${step("/견적")}&exited=true`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual(["sess_1"]);
  });

  it("화면 필터로 세션을 거른다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await seedPageView(store, project.projectId, "sess_1", daysAgo(1), "/a");
    await seedPageView(store, project.projectId, "sess_2", daysAgo(1), "/b");

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/sessions?screen=%2Fb`,
      headers,
    });

    expect(response.json().total).toBe(1);
    expect(response.json().sessions[0].sessionId).toBe("sess_2");
  });

  it.each([
    ["?screen=%2Fa&step=%2Fa", "invalid_session_filter"],
    ["?featurePath=%2Fa", "invalid_session_filter"],
    ["?start=%2Fa", "invalid_session_filter"],
    ["?step=%2Fa&exited=yes", "invalid_session_filter"],
    ["?days=2", "invalid_period"],
  ])("%s 는 400 %s 다", async (query, error) => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({ method: "GET", url: `/admin/api/projects/${project.projectId}/sessions${query}`, headers });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
  });
});
```

Run: `npx vitest run apps/api/src/routes/admin.test.ts`
Expected: FAIL — 라우트가 아직 `listSessions(projectId, SESSION_LIMIT)`을 부른다(`npm run typecheck`도 이 줄에서 실패한다).

- [ ] **Step 8: 라우트를 고친다**

`apps/api/src/routes/admin-proxy.ts`의 import 를 고친다.

```ts
import { parsePathStart, parsePeriod, parseSessionFilter } from "./aggregation-query.js";
```

`SESSION_LIMIT` 위의 주석을 바꾼다.

```ts
// 페이지 넘기기는 넣지 않는다. 화면은 total 로 "N개 중 최근 50개"를 보여준다.
// 쌓이는 것을 본 뒤에 만든다.
const SESSION_LIMIT = 50;
const PAGE_STATS_LIMIT = 50;
```

`sessions` 핸들러를 바꾼다.

```ts
  app.get("/admin/api/projects/:projectId/sessions", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const period = parsePeriod(request.query);
    if (!period) return reply.code(400).send({ error: "invalid_period" });
    const filter = parseSessionFilter(request.query);
    if (!filter) return reply.code(400).send({ error: "invalid_session_filter" });
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const list = await options.store.listSessions(projectId, { since: period.since, filter, limit: SESSION_LIMIT });
    return reply.header("cache-control", "no-store").send(list);
  });
```

- [ ] **Step 9: 통과 확인 후 커밋한다**

```bash
npx vitest run apps/api/src/routes/admin.test.ts
npm run typecheck && npm test 2>&1 | tail -4
git add apps/api/src/store apps/api/src/routes
git status --short    # 위 두 폴더 밖의 변경이 없어야 한다
git commit -q -m "집계: 세션 목록에 기간과 화면·기능·경로 필터를 더한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

관리자 화면(`apps/admin/src/api.ts`)은 응답의 `sessions`만 읽으므로 고치지 않는다. 확인만 한다.

```bash
grep -n "sessions" apps/admin/src/api.ts
```

Expected: `body.sessions`를 돌려주는 줄이 있다.

---

### Task 6: 데모에서 확인한다

**Files:** 없음(확인만 한다. 문제가 있으면 멈추고 보고한다)

- [ ] **Step 1: 빌드와 전체 확인**

```bash
npm run build
npm run typecheck
npm test 2>&1 | tail -5
```

Expected: 빌드 성공, 타입 오류 없음, 전체 PASS.

- [ ] **Step 2: 개발 서버를 워크트리의 새 DB 로 띄운다**

메인 저장소의 개발 DB를 건드리지 않도록 워크트리 안에 DB 파일을 따로 둔다.

```bash
cp /Users/choimiae/workspace/trace/.env .env 2>/dev/null || cp .env.example .env
cp /Users/choimiae/workspace/trace/apps/api/.env apps/api/.env 2>/dev/null || cp apps/api/.env.example apps/api/.env
lsof -iTCP -sTCP:LISTEN -P | grep -E ':(3000|4000|5173)\b'
```

포트 3000·4000·5173을 다른 프로세스가 쓰고 있으면 멈추고 사용자에게 알린다. 그 서버는 이 워크트리의 코드가 아니다.

```bash
TRACE_DB_PATH=./trace.stage3-1.db npm run dev:api     # 백그라운드
npm run dev:admin                                      # 백그라운드
npm run dev:demo                                       # 백그라운드
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/admin/api/projects/proj_x/features
```

Expected: 마지막 줄이 `401`이다(새 라우트가 있고 로그인을 요구한다. 옛 서버면 `404`).

- [ ] **Step 3: 브라우저에서 돌아다닌다**

1. `http://localhost:5173` → 로컬 로그인 → 프로젝트 생성(이름 `데모`, 허용 도메인 `http://localhost:3000`).
2. `http://localhost:3000/?projectId=<프로젝트 ID>`를 연다.
3. **돌아다닌 화면 순서를 적어 둔다.** 예: 대시보드 → 고객사 → 고객 상세 → 고객사 → 청구. 화면마다 버튼을 한두 번 누르고, 중간에 한 번 새로고침(F5)한다.
4. 새 탭으로 같은 주소를 열어 다른 순서로 두 화면을 다닌다.

- [ ] **Step 4: 세 API 를 불러 숫자를 맞춘다**

관리자 탭(`http://localhost:5173`)의 개발자 도구 콘솔에서 실행한다(쿠키가 실려야 하므로 관리자 탭에서 부른다).

```js
const base = "http://localhost:4000/admin/api/projects/<프로젝트 ID>";
const get = async (path) => (await fetch(base + path, { credentials: "include" })).json();
const features = await get("/features?days=1");
const paths = await get("/paths?days=1");
const sessions = await get("/sessions?days=1");
const first = paths.paths[0];
const filtered = await get(
  "/sessions?days=1&" + first.steps.map((s) => "step=" + encodeURIComponent(s)).join("&") + `&exited=${first.exited}`,
);
console.log(JSON.stringify({ features, paths, sessions, filteredTotal: filtered.total, firstPathSessions: first.sessions }, null, 2));
```

Expected:
- `features.summary.sessions`와 `sessions.total`이 둘 다 `2`(탭 둘)다. `features.summary.visitors`는 `1`(같은 브라우저)이다.
- `features.screens`의 `name`이 데모 화면 제목(`… - Trace Demo SaaS`)이다. 누른 버튼이 그 화면의 `features`에 글자 이름으로 있다.
- `paths.paths`에 Step 3 에서 적은 순서가 새로고침을 하나로 합친 채 나온다(최대 5개, 5개 이하로 끝났으면 `exited: true`).
- `sessions.sessions[*].screens`가 각 탭에서 다닌 순서와 같다.
- `filteredTotal`과 `firstPathSessions`가 같다.

하나라도 다르면 멈추고 출력 JSON 을 그대로 보고한다.

- [ ] **Step 5: 개발 서버를 끈다**

백그라운드로 띄운 세 프로세스를 끈다. `trace.stage3-1.db*` 파일은 `.gitignore`에 걸리는지 확인한다.

```bash
git status --short --ignored | grep trace.stage3-1
```

Expected: `!! trace.stage3-1.db`처럼 무시된 파일로 나온다. 추적 대상으로 나오면 멈추고 보고한다.

---

### Task 7: 브랜치 마감

- [ ] **Step 1: 마감한다**

superpowers:finishing-a-development-branch를 따른다. 로컬 `main`으로 fast-forward 머지하고 푸시는 하지 않는다. 워크트리 안의 무시된 파일(`git -C .worktrees/aggregate status --porcelain --ignored | grep -v node_modules | grep -v dist | grep -v tsbuildinfo`)을 사용자에게 보고한 뒤 워크트리와 브랜치를 지운다. `trace.stage3-1.db*`는 데모 확인용이라 지워도 되지만, 지우기 전에 사용자에게 알린다.

- [ ] **Step 2: 마감 상태를 확인한다**

```bash
cd /Users/choimiae/workspace/trace
npm run build && npm run typecheck && npm test 2>&1 | tail -5
git log --oneline origin/main..main
```

Expected: 모두 통과. 사용자에게 푸시가 필요하다고 알리고, 다음 묶음이 ③-2 화면임을 알린다.
