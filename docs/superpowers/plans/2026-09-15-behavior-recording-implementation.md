# 행동 기록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SPA 안의 이동·이탈·스크롤을 기록해 한 방문의 흐름이 온전히 남게 하고, 그 기록으로 페이지 기준 통계를 센다.

**Architecture:** SDK 의 `installCollectors` 에 세 수집기를 더한다 — `history` 패치와 `hashchange` 로 라우팅마다 `page_view`, `pagehide` 와 라우팅 직전에 `page_leave`, 스크롤 깊이 25·50·75·100% 마일스톤. 서버·계약은 이미 이 이벤트들을 받을 수 있으므로(`eventTypeSchema` 16종) 손대지 않는다. 화면은 커밋 전 워크트리에 있는 세션 목록·타임라인을 되살려 커밋하고, 그 위에 페이지 통계를 새로 만든다.

**Tech Stack:** TypeScript, esbuild(IIFE 번들), vitest 2 (SDK 는 jsdom), Fastify 5, better-sqlite3, React 18

**Spec:** `docs/superpowers/specs/2026-09-15-behavior-recording-design.md`

## Global Constraints

- **설치는 스크립트 한 줄이다.** `<script src=".../trace.js" data-project-id="proj_xxx"></script>` 외의 설정을 요구하지 않는다.
- **기본 번들 `dist/trace.js` 는 gzip 10,240 B 미만.** `packages/sdk/src/bundle-size.test.ts` 가 강제한다. **측정 시점 현재 6,426 B 로 여유는 3,814 B 다.** 세 수집기를 더해도 이 안에 들어가야 한다.
- **쿠키·localStorage·sessionStorage 를 쓰지 않는다.** 한 방문 = 한 세션이다. 사용자 식별을 하지 않는다.
- **`visibilitychange` 를 쓰지 않는다.** 탭 전환마다 이탈로 잡히면 체류가 잘게 쪼개지고 이어 붙일 방법이 없다(스펙 §2).
- **체류 시간을 저장하지 않는다.** `page_view` 와 다음 `page_leave` 의 차이로 조회 시점에 계산한다(스펙 §2).
- **스크롤 깊이는 `metadata.score` 에 담는다.** `safeMetadataSchema` 는 `.strict()` 라 새 키(`depth` 등)를 거절하고, 거절되면 `eventBatchSchema.parse` 가 실패해 **배치 전체가 400** 이 된다(무관한 click·page_view 까지 함께 버려진다). 검증함: `{ depth: 25 }` → `Unrecognized key(s) in object: 'depth'`, `{ metric: "scroll_depth", score: 25 }` → 통과. `score` 는 0~100 이라 백분율에 그대로 맞는다.
- **스크롤 깊이는 화면 바닥 기준이다.** `(scrollTop + viewportHeight) / documentHeight` — 스펙 §3 에 이유가 있다.
- **두 스토어 구현(`MemoryStore`·`SqliteStore`)은 동작이 같아야 한다.** 새 메서드는 `apps/api/src/store/store-contract.test.ts` 한 곳에 테스트를 쓰고 두 구현이 함께 통과해야 한다.
- 커밋 메시지는 한국어다(`AGENTS.md`). 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` 를 붙인다.
- **`package-lock.json` 은 커밋하지 않는다.** npm install 이 건드리면 `git checkout -- package-lock.json` 으로 되돌린다.
- 테스트 명령: 루트에서 `npm test`. 개별은 `npm test --workspace @trace/sdk` / `@trace/api` / `@trace/admin`. 타입은 `npm run typecheck`.

---

## File Structure

**생성**

| 파일 | 책임 |
|---|---|
| `packages/sdk/src/navigation.ts` | `history` 패치·`hashchange` 구독. 경로가 바뀌면 콜백 |
| `packages/sdk/src/navigation.test.ts` | 위의 테스트 |
| `packages/sdk/src/scroll.ts` | 깊이 마일스톤 판정. 순수 함수 + 구독 |
| `packages/sdk/src/scroll.test.ts` | 위의 테스트 |
| `packages/sdk/src/collectors.test.ts` | 세 수집기가 실제로 이벤트를 내는지 |
| `apps/admin/src/pages/PageStatsPage.tsx` | 페이지 기준 통계 화면 |
| `apps/admin/src/pages/PageStatsPage.test.tsx` | 위의 테스트 |

**수정**

| 파일 | 무엇을 |
|---|---|
| `packages/sdk/src/collectors.ts` | 세 수집기를 배선 |
| `apps/api/src/store/types.ts` | `PageStats` 타입, `listPageStats` 계약 |
| `apps/api/src/store/memory-store.ts` | `listPageStats` 구현 |
| `apps/api/src/store/sqlite-store.ts` | `listPageStats` 구현 |
| `apps/api/src/store/store-contract.test.ts` | 집계 계약 테스트 |
| `apps/api/src/routes/admin-proxy.ts` | `GET /admin/api/projects/:projectId/page-stats` |
| `apps/admin/src/api.ts` | `PageStatsResponse`, `getPageStats` |
| `apps/admin/src/App.tsx` | 통계 화면 상태와 진입 |
| `apps/admin/src/pages/DashboardPage.tsx` | 통계 화면으로 가는 버튼 |
| `README.md` | 수집 항목 표에 새 이벤트 세 줄 |

**되살릴 것 (Task 5)**

커밋 전 워크트리 `.worktrees/session-list` 에 세션 목록·타임라인 다이얼로그가 17개 파일로 남아 있다. Task 5 가 그것을 브랜치로 옮겨 커밋한다.

---

## Task 1: 라우팅 감지

**Files:**
- Create: `packages/sdk/src/navigation.ts`
- Test: `packages/sdk/src/navigation.test.ts`

**Interfaces:**
- Produces: `installNavigationWatcher(target: Window, onRouteChange: (urlPath: string) => void): () => void`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/sdk/src/navigation.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { installNavigationWatcher } from "./navigation.js";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("installNavigationWatcher", () => {
  it("pushState 로 경로가 바뀌면 알린다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/settings");

    expect(onRouteChange).toHaveBeenCalledWith("/settings");
    dispose();
  });

  // SPA 는 같은 경로로 replaceState 를 자주 부른다. 거르지 않으면 같은 화면이
  // 수십 줄 쌓인다.
  it("같은 경로로 다시 밀면 알리지 않는다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/settings");
    window.history.replaceState(null, "", "/settings");
    window.history.pushState(null, "", "/settings");

    expect(onRouteChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("쿼리만 바뀐 이동은 같은 페이지로 본다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/settings");
    window.history.pushState(null, "", "/settings?tab=2");

    expect(onRouteChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("해시 라우트를 경로로 읽는다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/#/reports");

    expect(onRouteChange).toHaveBeenCalledWith("/reports");
    dispose();
  });

  it("popstate 로 뒤로 가도 알린다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/settings");
    onRouteChange.mockClear();
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(onRouteChange).toHaveBeenCalledWith("/");
    dispose();
  });

  it("dispose 하면 원래 history 로 되돌리고 더 알리지 않는다", () => {
    const original = window.history.pushState;
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);
    dispose();

    window.history.pushState(null, "", "/settings");

    expect(onRouteChange).not.toHaveBeenCalled();
    expect(window.history.pushState).toBe(original);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- src/navigation.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 구현한다**

`packages/sdk/src/navigation.ts`

```ts
import { redactUrl } from "@trace/shared/privacy";

/**
 * SPA 라우팅을 감지한다. `page_view` 가 최초 1회만 나가던 것이 이 제품에서
 * "어떤 페이지를 거쳤나" 를 통째로 비게 만들었다.
 *
 * Navigation API 를 쓰지 않는다 — Chrome 계열 전용이라 self-hosted 고객의
 * 브라우저를 가른다. history 패치는 오래된 방식이지만 어디서나 돈다.
 */
export function installNavigationWatcher(
  target: Window,
  onRouteChange: (urlPath: string) => void,
): () => void {
  const currentPath = () => redactUrl(target.location.href).urlPath;
  let lastPath = currentPath();

  const notifyIfChanged = () => {
    const next = currentPath();
    // 쿼리만 바뀐 이동은 같은 페이지다. 정제된 경로로만 비교한다.
    if (next === lastPath) return;
    lastPath = next;
    onRouteChange(next);
  };

  const history = target.history;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function patchedPushState(...args) {
    originalPushState.apply(this, args);
    notifyIfChanged();
  };
  history.replaceState = function patchedReplaceState(...args) {
    originalReplaceState.apply(this, args);
    notifyIfChanged();
  };

  target.addEventListener("popstate", notifyIfChanged);
  target.addEventListener("hashchange", notifyIfChanged);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    target.removeEventListener("popstate", notifyIfChanged);
    target.removeEventListener("hashchange", notifyIfChanged);
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- src/navigation.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/sdk/src/navigation.ts packages/sdk/src/navigation.test.ts
git commit -m "$(cat <<'EOF'
수집: SPA 라우팅을 감지한다

page_view 가 installCollectors 최초 1회만 나가고 있었다. 사용자 앱(SPA,
해시 라우팅)에서 실측하니 이벤트 20건에 경로는 2개였고 그중 하나는 별도
창이었다 - SPA 안을 아무리 돌아다녀도 기록이 "/" 한 줄이었다.

같은 경로로 다시 밀면 알리지 않는다. SPA 는 같은 경로로 replaceState 를
자주 불러서, 거르지 않으면 같은 화면이 수십 줄 쌓인다.

Navigation API 를 쓰지 않는다 - Chrome 계열 전용이라 self-hosted 고객의
브라우저를 가른다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 스크롤 마일스톤

**Files:**
- Create: `packages/sdk/src/scroll.ts`
- Test: `packages/sdk/src/scroll.test.ts`

**Interfaces:**
- Produces:
  - `SCROLL_MILESTONES: readonly [25, 50, 75, 100]`
  - `reachedMilestones(depthPercent: number, already: ReadonlySet<number>): number[]`
  - `installScrollWatcher(target: Window, onMilestone: (percent: number) => void): { reset: () => void; dispose: () => void }`

- [ ] **Step 1: 실패하는 순수 함수 테스트를 쓴다**

`packages/sdk/src/scroll.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { installScrollWatcher, reachedMilestones, SCROLL_MILESTONES } from "./scroll.js";

describe("reachedMilestones", () => {
  it("넘은 구간을 모두 돌려준다", () => {
    expect(reachedMilestones(60, new Set())).toEqual([25, 50]);
  });

  it("이미 보낸 구간은 빼고 돌려준다", () => {
    expect(reachedMilestones(60, new Set([25]))).toEqual([50]);
  });

  it("되돌아 올라가면 아무것도 돌려주지 않는다", () => {
    expect(reachedMilestones(10, new Set([25, 50]))).toEqual([]);
  });

  it("끝까지 내리면 100 까지 돌려준다", () => {
    expect(reachedMilestones(100, new Set())).toEqual([...SCROLL_MILESTONES]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- src/scroll.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 순수 함수를 구현한다**

`packages/sdk/src/scroll.ts`

```ts
export const SCROLL_MILESTONES = [25, 50, 75, 100] as const;

/** 아직 안 보낸 구간 중 이번 깊이로 넘은 것들. 오름차순이다. */
export function reachedMilestones(
  depthPercent: number,
  already: ReadonlySet<number>,
): number[] {
  return SCROLL_MILESTONES.filter(
    (milestone) => depthPercent >= milestone && !already.has(milestone),
  );
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- src/scroll.test.ts`
Expected: PASS

- [ ] **Step 5: 구독기 테스트를 더한다**

`scroll.test.ts` 에 이어서 쓴다.

```ts
function stubDocument(documentHeight: number, viewportHeight: number, scrollTop: number) {
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(documentHeight);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(viewportHeight);
  Object.defineProperty(window, "scrollY", { value: scrollTop, configurable: true });
}

describe("installScrollWatcher", () => {
  it("구간을 넘으면 한 번씩만 알린다", () => {
    stubDocument(2000, 500, 500); // (500 + 500) / 2000 = 50%
    const onMilestone = vi.fn();
    const watcher = installScrollWatcher(window, onMilestone);

    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));

    expect(onMilestone.mock.calls.map((call) => call[0])).toEqual([25, 50]);
    watcher.dispose();
  });

  // 문서가 뷰포트보다 짧으면 스크롤이 불가능하다. 100% 를 즉시 보내면
  // "끝까지 읽었다" 와 구분되지 않는다.
  it("스크롤이 불가능한 문서는 아무것도 보내지 않는다", () => {
    stubDocument(400, 500, 0);
    const onMilestone = vi.fn();
    const watcher = installScrollWatcher(window, onMilestone);

    window.dispatchEvent(new Event("scroll"));

    expect(onMilestone).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("reset 하면 같은 구간을 다시 보낸다", () => {
    stubDocument(2000, 500, 500);
    const onMilestone = vi.fn();
    const watcher = installScrollWatcher(window, onMilestone);

    window.dispatchEvent(new Event("scroll"));
    watcher.reset();
    window.dispatchEvent(new Event("scroll"));

    expect(onMilestone.mock.calls.map((call) => call[0])).toEqual([25, 50, 25, 50]);
    watcher.dispose();
  });

  it("dispose 하면 더 알리지 않는다", () => {
    stubDocument(2000, 500, 500);
    const onMilestone = vi.fn();
    const watcher = installScrollWatcher(window, onMilestone);
    watcher.dispose();

    window.dispatchEvent(new Event("scroll"));

    expect(onMilestone).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- src/scroll.test.ts`
Expected: FAIL — `installScrollWatcher` 가 없다

- [ ] **Step 7: 구독기를 구현한다**

`scroll.ts` 에 이어서 쓴다.

```ts
export function installScrollWatcher(
  target: Window,
  onMilestone: (percent: number) => void,
): { reset: () => void; dispose: () => void } {
  let sent = new Set<number>();

  const onScroll = () => {
    const documentHeight = target.document.documentElement.scrollHeight;
    const viewportHeight = target.innerHeight;
    // 스크롤이 불가능한 문서는 세지 않는다. 100% 를 즉시 보내면 "끝까지
    // 읽었다" 와 구분되지 않는다.
    if (documentHeight <= viewportHeight) return;

    // 화면 바닥 기준이다. scrollTop / (documentHeight - viewportHeight) 로
    // 재면 "얼마나 움직였나" 가 되어 문서 길이에 따라 같은 25% 가 다른
    // 의미가 된다.
    const depthPercent = ((target.scrollY + viewportHeight) / documentHeight) * 100;
    for (const milestone of reachedMilestones(depthPercent, sent)) {
      sent.add(milestone);
      onMilestone(milestone);
    }
  };

  target.addEventListener("scroll", onScroll, { passive: true });

  return {
    reset: () => {
      sent = new Set();
    },
    dispose: () => target.removeEventListener("scroll", onScroll),
  };
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- src/scroll.test.ts`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add packages/sdk/src/scroll.ts packages/sdk/src/scroll.test.ts
git commit -m "$(cat <<'EOF'
수집: 스크롤 깊이를 마일스톤으로만 남긴다

25·50·75·100% 도달 시점만 보낸다. 페이지당 최대 4건이라 이벤트 수가
상수로 묶인다. 되돌아 올라가도 다시 보내지 않는다.

깊이는 화면 바닥 기준이다. scrollTop / (documentHeight - viewportHeight)
로 재면 "얼마나 움직였나" 가 되어 문서 길이에 따라 같은 25% 가 다른
의미가 된다.

스크롤이 불가능한 문서는 아무것도 보내지 않는다 - 100% 를 즉시 보내면
"끝까지 읽었다" 와 구분되지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 수집기 배선

**Files:**
- Modify: `packages/sdk/src/collectors.ts:69-124`
- Test: `packages/sdk/src/collectors.test.ts` (생성)

**Interfaces:**
- Consumes: Task 1 의 `installNavigationWatcher`, Task 2 의 `installScrollWatcher`
- Produces: `installCollectors` 가 `page_view`(라우팅마다) · `page_leave`(이탈·라우팅 직전) · `scroll`(마일스톤) 을 큐에 넣는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/sdk/src/collectors.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceClient } from "./client.js";
import { installCollectors } from "./collectors.js";

function queuedTypes(client: TraceClient): string[] {
  // enqueue 를 가로채 큐를 직접 본다. flush 는 전송까지 가므로 여기서는 쓰지 않는다.
  return captured.map((event) => event.type);
}

let captured: Array<{ type: string; urlPath: string; metadata: Record<string, unknown> }> = [];

function makeClient(): TraceClient {
  const client = new TraceClient({
    projectId: "proj_1",
    endpoint: "https://trace.example.com/v1/events/batch",
    consent: "granted",
  });
  vi.spyOn(client, "enqueue").mockImplementation((event) => {
    captured.push(event as never);
  });
  return client;
}

beforeEach(() => {
  captured = [];
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("installCollectors", () => {
  it("시작할 때 page_view 를 한 번 보낸다", () => {
    installCollectors(makeClient());

    expect(queuedTypes()).toEqual(["page_view"]);
  });

  it("라우팅하면 직전 페이지의 page_leave 를 먼저, 새 page_view 를 다음에 보낸다", () => {
    installCollectors(makeClient());
    captured = [];

    window.history.pushState(null, "", "/settings");

    expect(captured.map((event) => [event.type, event.urlPath])).toEqual([
      ["page_leave", "/"],
      ["page_view", "/settings"],
    ]);
  });

  it("떠날 때 page_leave 를 보낸다", () => {
    installCollectors(makeClient());
    captured = [];

    window.dispatchEvent(new Event("pagehide"));

    expect(captured.map((event) => event.type)).toEqual(["page_leave"]);
  });

  it("스크롤 마일스톤을 metadata 의 metric·score 로 담는다", () => {
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    installCollectors(makeClient());
    captured = [];

    window.dispatchEvent(new Event("scroll"));

    expect(captured.map((event) => [event.type, event.metadata])).toEqual([
      ["scroll", { metric: "scroll_depth", score: 25 }],
      ["scroll", { metric: "scroll_depth", score: 50 }],
    ]);
  });

  it("라우팅하면 스크롤 마일스톤이 초기화된다", () => {
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    installCollectors(makeClient());
    window.dispatchEvent(new Event("scroll"));
    window.history.pushState(null, "", "/settings");
    captured = [];

    window.dispatchEvent(new Event("scroll"));

    expect(captured.map((event) => event.metadata)).toEqual([
      { metric: "scroll_depth", score: 25 },
      { metric: "scroll_depth", score: 50 },
    ]);
  });
});
```

> `queuedTypes` 는 `captured` 를 읽는 헬퍼다. 위 코드에서 인자를 받지 않도록 `function queuedTypes(): string[] { return captured.map((event) => event.type); }` 로 고쳐 쓴다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- src/collectors.test.ts`
Expected: FAIL — `page_leave`·`scroll` 이 나오지 않는다

- [ ] **Step 3: 배선한다**

`collectors.ts` 의 `installCollectors` 를 고친다. 기존 `click`·`error` 수집기는 그대로 둔다.

```ts
export function installCollectors(client: TraceClient) {
  const currentPath = () => redactUrl(window.location.href).urlPath;

  const sendPageView = (urlPath: string) => {
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "page_view",
        urlPath,
        metadata: {},
      }),
    );
  };

  const sendPageLeave = (urlPath: string) => {
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "page_leave",
        urlPath,
        metadata: {},
      }),
    );
  };

  // 떠난 페이지의 경로를 들고 있어야 한다. page_leave 를 보낼 시점에는
  // location 이 이미 새 경로다.
  let openPath = currentPath();
  sendPageView(openPath);

  const scrollWatcher = installScrollWatcher(window, (depth) => {
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "scroll",
        urlPath: currentPath(),
        // safeMetadataSchema 는 .strict() 라 새 키를 거절한다. depth 를
        // 그대로 넣으면 배치 전체가 400 이 된다. score 는 0~100 이라
        // 백분율에 그대로 맞는다.
        metadata: { metric: "scroll_depth", score: depth },
      }),
    );
  });

  installNavigationWatcher(window, (urlPath) => {
    sendPageLeave(openPath);
    openPath = urlPath;
    sendPageView(urlPath);
    // 새 페이지는 처음부터 다시 센다.
    scrollWatcher.reset();
  });

  window.addEventListener("pagehide", () => sendPageLeave(openPath));

  // ... 기존 click 수집기 그대로 ...
  // ... 기존 error 수집기 그대로 ...

  installTransport(client);
}
```

`collectors.ts` 상단에 import 를 더한다.

```ts
import { installNavigationWatcher } from "./navigation.js";
import { installScrollWatcher } from "./scroll.js";
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- src/collectors.test.ts`
Expected: PASS

- [ ] **Step 5: 번들 예산을 확인한다**

Run: `npm test --workspace @trace/sdk -- src/bundle-size.test.ts`
Expected: PASS. 측정 시점 기준 6,426 B 였고 예산은 10,240 B 다. 넘으면 세 수집기 중 무엇이 큰지 재고 보고한다 — 예산을 올리지 않는다.

- [ ] **Step 6: SDK 전체를 돌린다**

Run: `npm test --workspace @trace/sdk`
Expected: PASS — 기존 테스트가 하나도 깨지지 않아야 한다

- [ ] **Step 7: 커밋**

```bash
git add packages/sdk/src/collectors.ts packages/sdk/src/collectors.test.ts
git commit -m "$(cat <<'EOF'
수집: 라우팅마다 page_view, 떠날 때 page_leave, 스크롤 마일스톤을 보낸다

계약에 이벤트가 16종 정의돼 있는데 SDK 는 3종만 보내고 있었다. 이제
page_view·page_leave·scroll 이 더해져 한 방문의 흐름이 남는다.

떠난 페이지의 경로를 따로 들고 있는다. page_leave 를 보낼 시점에는
location 이 이미 새 경로다.

체류 시간은 저장하지 않는다. page_view 와 다음 page_leave 의 차이로
조회 시점에 계산한다 - 중복 저장하면 둘이 어긋날 때 무엇이 맞는지
알 수 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 실측 — 경로가 몇 개로 늘어나는가

**Files:**
- 없음 (수동 검증)

**Interfaces:**
- Consumes: Task 3 의 수집기

이 스펙이 고치려는 숫자를 직접 확인한다. **경로 2개** 가 출발점이다.

- [ ] **Step 1: 서버 셋을 띄운다**

```bash
npm run dev:api     # 4000
npm run dev:admin   # 5173
```

- [ ] **Step 2: 대상 앱에 SDK 를 붙인다**

`localhost:3000` 의 SPA 를 연 뒤 브라우저 콘솔에서 주입한다(앱 파일을 고치지 않는다).

```js
const s = document.createElement("script");
s.src = "http://localhost:4000/trace.js";
s.dataset.projectId = "<프로젝트 ID>";
document.head.appendChild(s);
```

- [ ] **Step 3: 화면을 옮겨 다닌다**

메뉴를 눌러 **최소 다섯 화면**을 거치고, 각 화면에서 끝까지 스크롤해 본 뒤, 탭을 닫는다.

- [ ] **Step 4: 잰다**

```bash
sqlite3 apps/api/trace.db "
select count(*) as events,
       count(distinct session_id) as sessions,
       count(distinct url_path) as paths,
       group_concat(distinct type) as kinds
  from events;"
```

- [ ] **경로가 2개에서 몇 개로 늘었는가** — 이 스펙이 고치려는 숫자다. 늘지 않았으면 라우팅 감지가 안 걸린 것이니 멈추고 보고한다
- [ ] `page_leave` 와 `scroll` 이 `kinds` 에 있는가
- [ ] 세션당 이벤트 수가 감당할 만한가

- [ ] **Step 5: 타임라인이 흐름으로 읽히는가**

관리자에서 그 세션의 타임라인을 열어 `page_view → click → scroll → page_view` 순서가 실제 이동과 맞는지 눈으로 본다. 안 맞으면 멈추고 보고한다.

---

## Task 5: 세션 목록·타임라인 되살리기

**Files:**
- Modify: 워크트리 `.worktrees/session-list` 의 17개 파일을 이 브랜치로 옮긴다

**Interfaces:**
- Produces: `GET /admin/api/projects/:projectId/sessions`, `SessionTable`, `SessionDetailDialog`, store 의 `listSessions(projectId, limit)`

커밋 전 상태로 워크트리에 남아 있는 작업이다. 내용은 이미 검증됐다(테스트 1029개 통과, 브라우저에서 세션 5개·타임라인 11건 확인).

- [ ] **Step 1: 변경 목록을 확인한다**

```bash
git -C .worktrees/session-list status --porcelain
```

17개 파일이 나와야 한다. 다르면 멈추고 보고한다.

- [ ] **Step 2: 패치로 옮긴다**

```bash
git -C .worktrees/session-list diff HEAD > /tmp/session-list.patch
git apply /tmp/session-list.patch
```

`RM` 로 표시된 이름 변경(`RecordedSessionTable` → `SessionTable`)이 포함되므로, `git apply` 가 실패하면 `git -C .worktrees/session-list diff HEAD --binary` 로 다시 뜬다.

- [ ] **Step 3: 전체를 돌린다**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. 이 브랜치에는 Task 1~3 의 새 이벤트가 있으므로, 세션 목록의 이벤트 수가 늘어나는 것 외에 달라질 것은 없다.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "$(cat <<'EOF'
관리자: 이슈를 거치지 않고 세션 흐름을 본다

문제 상세 안에서만 닿을 수 있던 세션 타임라인을 목록에서 바로 연다.
기록된 세션 카드는 이 목록에 흡수됐다 - 비슷한 표 둘이 나란히 서는 것을
막고, 기록 유무를 한 컬럼으로 보여준다.

세션 테이블이 따로 없으므로 events 를 session_id 로 묶어 센다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 페이지 통계 — store

**Files:**
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: Task 3 이 만드는 `page_view`·`page_leave`·`scroll` 이벤트
- Produces:
  - `PageStats { urlPath: string; views: number; averageDwellMs: number | undefined; exitRate: number; scrollReach: { depth: number; ratio: number }[] }`
  - `listPageStats(projectId: string, limit: number): Promise<PageStats[]>`

- [ ] **Step 1: 실패하는 계약 테스트를 쓴다**

`store-contract.test.ts` 의 `describeTraceStoreContract` 본문에 더한다. 스토어는 **`open()`** 으로 얻는다.

```ts
it("페이지별 방문·체류·이탈·스크롤 도달을 센다", async () => {
  const store = open();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });
  const event = (
    sessionId: string,
    eventId: string,
    type: "page_view" | "page_leave" | "scroll",
    urlPath: string,
    timestamp: string,
    metadata: Record<string, unknown> = {},
  ) => ({ eventId, sessionId, pageId: "page_1", timestamp, type, urlPath, metadata });

  await store.saveBatch({
    projectId: project.projectId,
    anonymousUserId: "anon_1",
    sessionId: "sess_1",
    sentAt: "2026-09-15T00:10:00.000Z",
    sdkVersion: "0.1.0",
    url: "https://demo.example.com/",
    events: [
      event("sess_1", "evt_1", "page_view", "/home", "2026-09-15T00:00:00.000Z"),
      event("sess_1", "evt_2", "scroll", "/home", "2026-09-15T00:00:05.000Z", {
        metric: "scroll_depth",
        score: 50,
      }),
      event("sess_1", "evt_3", "page_leave", "/home", "2026-09-15T00:00:10.000Z"),
      event("sess_1", "evt_4", "page_view", "/report", "2026-09-15T00:00:10.000Z"),
      event("sess_1", "evt_5", "page_leave", "/report", "2026-09-15T00:00:40.000Z"),
    ],
  });

  const stats = await store.listPageStats(project.projectId, 50);
  const home = stats.find((row) => row.urlPath === "/home")!;
  const report = stats.find((row) => row.urlPath === "/report")!;

  expect(home.views).toBe(1);
  expect(home.averageDwellMs).toBe(10_000);
  // /home 은 세션의 마지막 page_view 가 아니다.
  expect(home.exitRate).toBe(0);
  expect(home.scrollReach).toEqual([
    { depth: 25, ratio: 0 },
    { depth: 50, ratio: 1 },
    { depth: 75, ratio: 0 },
    { depth: 100, ratio: 0 },
  ]);

  expect(report.views).toBe(1);
  expect(report.averageDwellMs).toBe(30_000);
  // /report 가 세션의 마지막 page_view 다.
  expect(report.exitRate).toBe(1);
});

// 브라우저가 강제 종료되면 page_leave 가 못 나간다. 0 으로 세면 평균이
// 끌려 내려간다.
it("짝 없는 방문은 평균 체류에서 뺀다", async () => {
  const store = open();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });

  await store.saveBatch({
    projectId: project.projectId,
    anonymousUserId: "anon_1",
    sessionId: "sess_1",
    sentAt: "2026-09-15T00:10:00.000Z",
    sdkVersion: "0.1.0",
    url: "https://demo.example.com/",
    events: [
      {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-15T00:00:00.000Z",
        type: "page_view" as const,
        urlPath: "/home",
        metadata: {},
      },
      {
        eventId: "evt_2",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-15T00:00:10.000Z",
        type: "page_leave" as const,
        urlPath: "/home",
        metadata: {},
      },
      {
        eventId: "evt_3",
        sessionId: "sess_2",
        pageId: "page_1",
        timestamp: "2026-09-15T00:01:00.000Z",
        type: "page_view" as const,
        urlPath: "/home",
        metadata: {},
      },
    ],
  });

  const stats = await store.listPageStats(project.projectId, 50);
  const home = stats.find((row) => row.urlPath === "/home")!;

  expect(home.views).toBe(2);
  // 짝이 있는 방문 하나만 평균에 들어간다.
  expect(home.averageDwellMs).toBe(10_000);
});

it("page_leave 가 하나도 없으면 평균 체류가 undefined 다", async () => {
  const store = open();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });

  await store.saveBatch({
    projectId: project.projectId,
    anonymousUserId: "anon_1",
    sessionId: "sess_1",
    sentAt: "2026-09-15T00:10:00.000Z",
    sdkVersion: "0.1.0",
    url: "https://demo.example.com/",
    events: [
      {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-15T00:00:00.000Z",
        type: "page_view" as const,
        urlPath: "/home",
        metadata: {},
      },
    ],
  });

  const stats = await store.listPageStats(project.projectId, 50);

  expect(stats[0]!.averageDwellMs).toBeUndefined();
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- src/store/store-contract.test.ts`
Expected: FAIL — `store.listPageStats is not a function`

- [ ] **Step 3: 계약을 타입에 적는다**

`apps/api/src/store/types.ts`, `SessionSummary` 아래에 더한다.

```ts
/** 페이지 기준 통계. 체류는 저장하지 않고 조회 시점에 계산한다. */
export interface PageStats {
  urlPath: string;
  views: number;
  /**
   * `page_view` 와 그 세션의 다음 `page_leave` 차이의 평균(ms).
   * 짝이 있는 방문이 하나도 없으면 `undefined` 다 — 0 과 구분해야 한다.
   */
  averageDwellMs: number | undefined;
  /** 그 페이지가 세션의 마지막 `page_view` 였던 비율. 0~1. */
  exitRate: number;
  /** 25·50·75·100 각각에 도달한 방문의 비율. 0~1. */
  scrollReach: Array<{ depth: number; ratio: number }>;
}
```

`TraceStore` 인터페이스에 더한다.

```ts
  /** `views` 내림차순. 많이 본 페이지가 먼저다. */
  listPageStats(projectId: string, limit: number): Promise<PageStats[]>;
```

- [ ] **Step 4: 공용 집계 함수를 만든다**

두 스토어가 같은 계산을 해야 하므로 이벤트 배열에서 통계를 내는 순수 함수를 만들고 둘이 함께 쓴다. `apps/api/src/store/page-stats.ts` 를 새로 만든다.

```ts
import type { TraceEvent } from "@trace/shared";
import type { PageStats } from "./types.js";

const SCROLL_DEPTHS = [25, 50, 75, 100];

/**
 * 이벤트에서 페이지 통계를 낸다. 두 스토어 구현이 같은 답을 내야 하므로
 * 계산은 여기 한 곳에만 둔다.
 */
export function computePageStats(events: TraceEvent[], limit: number): PageStats[] {
  const bySession = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const list = bySession.get(event.sessionId) ?? [];
    list.push(event);
    bySession.set(event.sessionId, list);
  }

  const views = new Map<string, { count: number; dwellMs: number[]; exits: number; reached: Map<number, number> }>();
  const bucket = (urlPath: string) => {
    const existing = views.get(urlPath);
    if (existing) return existing;
    const created = { count: 0, dwellMs: [] as number[], exits: 0, reached: new Map<number, number>() };
    views.set(urlPath, created);
    return created;
  };

  for (const sessionEvents of bySession.values()) {
    const ordered = [...sessionEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const pageViews = ordered.filter((event) => event.type === "page_view");
    const lastView = pageViews[pageViews.length - 1];

    for (const [index, view] of pageViews.entries()) {
      const target = bucket(view.urlPath);
      target.count += 1;
      if (view === lastView) target.exits += 1;

      const nextView = pageViews[index + 1];
      const leave = ordered.find(
        (event) =>
          event.type === "page_leave" &&
          event.urlPath === view.urlPath &&
          event.timestamp >= view.timestamp &&
          (nextView === undefined || event.timestamp <= nextView.timestamp),
      );
      if (leave) target.dwellMs.push(Date.parse(leave.timestamp) - Date.parse(view.timestamp));

      const scrolls = ordered.filter(
        (event) =>
          event.type === "scroll" &&
          event.urlPath === view.urlPath &&
          event.timestamp >= view.timestamp &&
          (nextView === undefined || event.timestamp < nextView.timestamp),
      );
      for (const depth of SCROLL_DEPTHS) {
        const hit = scrolls.some(
          (event) => event.metadata?.metric === "scroll_depth" && event.metadata?.score === depth,
        );
        if (hit) target.reached.set(depth, (target.reached.get(depth) ?? 0) + 1);
      }
    }
  }

  return Array.from(views.entries())
    .map(([urlPath, value]) => ({
      urlPath,
      views: value.count,
      averageDwellMs:
        value.dwellMs.length === 0
          ? undefined
          : Math.round(value.dwellMs.reduce((sum, ms) => sum + ms, 0) / value.dwellMs.length),
      exitRate: value.count === 0 ? 0 : value.exits / value.count,
      scrollReach: SCROLL_DEPTHS.map((depth) => ({
        depth,
        ratio: value.count === 0 ? 0 : (value.reached.get(depth) ?? 0) / value.count,
      })),
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}
```

- [ ] **Step 5: 두 스토어에 붙인다**

`sqlite-store.ts` 와 `memory-store.ts` 에 각각 더한다. 둘 다 이벤트를 모아 같은 함수에 넘긴다.

```ts
  async listPageStats(projectId: string, limit: number): Promise<PageStats[]> {
    const events = await this.listEvents(projectId);
    return computePageStats(events, limit);
  }
```

`import { computePageStats } from "./page-stats.js";` 와 `PageStats` 타입 import 를 각 파일에 더한다.

- [ ] **Step 6: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- src/store/store-contract.test.ts`
Expected: PASS — 두 구현 모두

- [ ] **Step 7: 커밋**

```bash
git add apps/api/src/store/types.ts apps/api/src/store/page-stats.ts apps/api/src/store/memory-store.ts apps/api/src/store/sqlite-store.ts apps/api/src/store/store-contract.test.ts
git commit -m "$(cat <<'EOF'
저장: 페이지별 방문·체류·이탈·스크롤 도달을 센다

체류는 저장하지 않는다. page_view 와 그 세션의 다음 page_leave 차이로
조회 시점에 계산한다 - 중복 저장하면 둘이 어긋날 때 무엇이 맞는지
알 수 없다.

짝 없는 방문은 평균에서 뺀다. 브라우저가 강제 종료되면 page_leave 가
못 나가는데, 그걸 0 으로 세면 평균이 끌려 내려간다. 짝이 하나도 없으면
undefined 다 - 0 과 구분해야 한다.

계산은 computePageStats 한 곳에만 둔다. 두 스토어가 같은 답을 내야 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 페이지 통계 — 라우트와 화면

**Files:**
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin-recording.test.ts`
- Modify: `apps/admin/src/api.ts`
- Create: `apps/admin/src/pages/PageStatsPage.tsx`
- Test: `apps/admin/src/pages/PageStatsPage.test.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 6 의 `listPageStats`
- Produces:
  - `GET /admin/api/projects/:projectId/page-stats` → `{ pages: PageStats[] }`
  - `getPageStats(projectId: string): Promise<PageStatsResponse[]>`
  - `<PageStatsPage pages={...} onBack={...} />`

- [ ] **Step 1: 실패하는 라우트 테스트를 쓴다**

`admin-recording.test.ts` 에 더한다. 상단 헬퍼(`authConfig`·`createAuthenticatedOwner`)는 이미 그 파일에 있다.

```ts
describe("GET /admin/api/projects/:projectId/page-stats", () => {
  it("페이지 통계를 돌려준다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-15T00:10:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-15T00:00:00.000Z",
          type: "page_view",
          urlPath: "/home",
          metadata: {},
        },
        {
          eventId: "evt_2",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-15T00:00:10.000Z",
          type: "page_leave",
          urlPath: "/home",
          metadata: {},
        },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/page-stats`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pages[0].urlPath).toBe("/home");
    expect(body.pages[0].views).toBe(1);
    expect(body.pages[0].averageDwellMs).toBe(10_000);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("인증이 없으면 401", async () => {
    const { app, project } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "GET",
      url: `/admin/api/projects/${project.projectId}/page-stats`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("조회자도 볼 수 있다", async () => {
    const { app, store, project } = await createAuthenticatedOwner();
    const viewer = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_viewer_stats",
      email: "viewer-stats@example.com",
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
      url: `/admin/api/projects/${project.projectId}/page-stats`,
      headers: { cookie: session.cookie.split(";")[0] as string },
    });

    expect(response.statusCode).toBe(200);
  });
});
```

> 하위 사용자의 이메일은 소유자의 `admin@example.com` 과 달라야 한다. 같으면 `upsertAdminUserFromGoogle` 이 `admin_email_conflict` 를 던져 라우트와 무관하게 실패한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- src/routes/admin-recording.test.ts`
Expected: FAIL — 404

- [ ] **Step 3: 라우트를 더한다**

`admin-proxy.ts` 의 `/sessions` 라우트 아래에 더한다. 상단 상수 옆에 상한을 둔다.

```ts
const PAGE_STATS_LIMIT = 50;
```

```ts
  app.get("/admin/api/projects/:projectId/page-stats", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_summary");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const pages = await options.store.listPageStats(projectId, PAGE_STATS_LIMIT);
    return reply.header("cache-control", "no-store").send({ pages });
  });
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- src/routes/admin-recording.test.ts`
Expected: PASS

- [ ] **Step 5: 클라이언트 함수를 더한다**

`apps/admin/src/api.ts` 에 타입과 함수를 더한다. 이 계층은 얇은 전달이라 단위 테스트를 두지 않는다 — 기존 `getSessionTimeline` 도 같다.

```ts
export interface PageStatsResponse {
  urlPath: string;
  views: number;
  averageDwellMs?: number;
  exitRate: number;
  scrollReach: Array<{ depth: number; ratio: number }>;
}

export async function getPageStats(projectId: string): Promise<PageStatsResponse[]> {
  const body = await getJson<{ pages: PageStatsResponse[] }>(
    `/admin/api/projects/${projectId}/page-stats`,
  );
  return body.pages;
}
```

- [ ] **Step 6: 실패하는 화면 테스트를 쓴다**

`apps/admin/src/pages/PageStatsPage.test.tsx`

```tsx
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageStatsPage } from "./PageStatsPage.js";

expect.extend(matchers);
afterEach(cleanup);

const pages = [
  {
    urlPath: "/home",
    views: 120,
    averageDwellMs: 45_000,
    exitRate: 0.25,
    scrollReach: [
      { depth: 25, ratio: 0.9 },
      { depth: 50, ratio: 0.6 },
      { depth: 75, ratio: 0.3 },
      { depth: 100, ratio: 0.1 },
    ],
  },
];

describe("PageStatsPage", () => {
  it("페이지별 방문·체류·이탈을 보여준다", () => {
    render(<PageStatsPage pages={pages} onBack={() => undefined} />);

    expect(screen.getByText("/home")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("45초")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  // page_leave 가 한 번도 안 나간 페이지가 있다. 0초로 보이면 "머물지 않았다"
  // 로 읽혀 사실과 다르다.
  it("체류를 모르면 값 대신 줄표를 보여준다", () => {
    render(
      <PageStatsPage
        pages={[{ ...pages[0]!, averageDwellMs: undefined }]}
        onBack={() => undefined}
      />,
    );

    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("스크롤 도달을 네 구간으로 보여준다", () => {
    render(<PageStatsPage pages={pages} onBack={() => undefined} />);

    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  it("비어 있으면 왜 비었는지 알려준다", () => {
    render(<PageStatsPage pages={[]} onBack={() => undefined} />);

    expect(screen.getByText(/아직 집계할 페이지 방문이 없습니다/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: 실패를 확인한다**

Run: `npm test --workspace @trace/admin -- src/pages/PageStatsPage.test.tsx`
Expected: FAIL — 모듈이 없다

- [ ] **Step 8: 화면을 구현한다**

`apps/admin/src/pages/PageStatsPage.tsx`

```tsx
import type { PageStatsResponse } from "../api.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { DataTable, type Column } from "../ui/DataTable.js";

function formatDwell(ms: number | undefined): string {
  // page_leave 가 한 번도 안 나간 페이지가 있다. 0초로 보이면 "머물지
  // 않았다" 로 읽혀 사실과 다르다.
  if (ms === undefined) return "-";

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function PageStatsPage({
  pages,
  onBack,
}: {
  pages: PageStatsResponse[];
  onBack: () => void;
}) {
  const columns: Array<Column<PageStatsResponse>> = [
    { key: "urlPath", header: "화면", render: (row) => <code>{row.urlPath}</code> },
    { key: "views", header: "방문", align: "end", render: (row) => String(row.views) },
    {
      key: "dwell",
      header: "평균 체류",
      align: "end",
      render: (row) => formatDwell(row.averageDwellMs),
    },
    { key: "exit", header: "이탈률", align: "end", render: (row) => percent(row.exitRate) },
    ...[25, 50, 75, 100].map((depth) => ({
      key: `reach-${depth}`,
      header: `${depth}%`,
      headerLabel: `스크롤 ${depth}% 도달`,
      align: "end" as const,
      render: (row: PageStatsResponse) =>
        percent(row.scrollReach.find((reach) => reach.depth === depth)?.ratio ?? 0),
    })),
  ];

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>페이지 통계</h1>
        </div>
        <div className="header-actions">
          <Button onClick={onBack}>대시보드로 돌아가기</Button>
        </div>
      </header>
      <Card as="section">
        <DataTable
          columns={columns}
          rows={pages}
          rowKey={(row) => row.urlPath}
          empty="아직 집계할 페이지 방문이 없습니다. 사이트에 스크립트를 붙이면 방문마다 쌓입니다."
        />
      </Card>
    </main>
  );
}
```

- [ ] **Step 9: 통과를 확인한다**

Run: `npm test --workspace @trace/admin -- src/pages/PageStatsPage.test.tsx`
Expected: PASS. 출력이 깨끗해야 한다 — React 경고가 뜨면 고친다.

- [ ] **Step 10: App 에 배선한다**

`App.tsx` 의 `AppState` 에 상태를 더한다.

```ts
  | {
      type: "page-stats";
      pages: PageStatsResponse[];
      dashboardData: { summary: DashboardSummary; issues: Issue[] };
      projects: ProjectOption[];
      projectId: string;
      userEmail: string;
      adminUserId: string;
      csrfToken: string;
      settingsSessionId: number;
    }
```

`DashboardPage` 에 `onShowPageStats` prop 을 더하고(기본값 `() => {}`), 헤더 버튼으로 `getPageStats` 를 불러 위 상태로 전환한다. `onBack` 은 `ready` 로 되돌린다 — 기존 `settings`·`audit` 상태의 되돌아가기와 같은 모양을 따른다.

- [ ] **Step 11: README 를 고친다**

`README.md` 의 「수집하는 것과 수집하지 않는 것」 표에 세 줄을 더한다.

```markdown
| 화면 이동 | SPA 라우팅을 포함해 페이지가 바뀔 때마다 경로를 기록합니다. 쿼리 값은 `[redacted]`로 바꿉니다 |
| 화면 이탈 | 페이지를 떠날 때 기록합니다. 두 시각의 차이로 체류 시간을 계산하며, 체류 시간 자체는 저장하지 않습니다 |
| 스크롤 | 25·50·75·100% 도달 시점만 기록합니다. 위치를 연속으로 기록하지 않습니다 |
```

- [ ] **Step 12: 전체를 돌린다**

Run: `npm test && npm run typecheck && npm run build`
Expected: 전부 통과

- [ ] **Step 13: 커밋**

```bash
git add -A
git commit -m "$(cat <<'EOF'
관리자: 페이지 기준 통계를 연다

방문·평균 체류·이탈률·스크롤 도달을 페이지별로 센다. 지금까지의 통계는
전부 이슈 기준이었고 "어느 화면을 얼마나 보는가" 에 답할 수단이 없었다.

체류를 모르는 페이지는 0초가 아니라 줄표로 보여준다. 0초면 "머물지
않았다" 로 읽혀 사실과 다르다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 완료 기준

- `npm test` 전부 통과, 출력에 경고가 없다
- `npm run typecheck`·`npm run build` 통과
- **SDK 번들이 gzip 10,240 B 미만** (`bundle-size.test.ts`)
- Task 4 실측에서 **경로 수가 2개에서 늘었다** — 이 계획이 고치려는 숫자다
- 세션 타임라인이 `page_view → click → scroll → page_leave` 로 읽힌다
- 조회자 계정으로 페이지 통계가 200 이다
