# ① 걷어내기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 행동 분석으로 제품을 다시 정의한 설계에 따라, 문제 감지·와이어프레임·팀 관리·`track()`·JS 오류·업로드 트리거·메모리 저장소를 코드와 테스트, 스키마, 문서에서 걷어낸다. 남는 기능(수집, 세션 목록·타임라인, 리플레이 녹화·재생, 페이지 통계, 로그인, 프로젝트 설정)은 계속 동작해야 한다.

**Architecture:** 소비자 쪽부터 걷어낸다. 먼저 SDK가 해당 데이터를 더는 보내지 않게 하고, 이어서 서버가 받지도 저장하지도 않게 하고, 관리자 화면이 쓰지 않게 한 뒤, 마지막에 공유 계약(`@trace/shared`)에서 지운다. 이 순서를 지키면 태스크가 끝날 때마다 타입 검사와 테스트가 모두 통과한다. 행동이 바뀌는 곳(리플레이 업로드 시점, 프로젝트 접근 권한, 수집 API가 모르는 이벤트를 다루는 방식)은 테스트를 먼저 쓴다.

**Tech Stack:** TypeScript, npm workspaces, vitest(jsdom), Fastify, `node:sqlite`, React, rrweb 2.0.0-alpha.4, esbuild

**Spec:** `docs/superpowers/specs/2026-09-30-behavior-analytics-redefinition-design.md`

## Global Constraints

- 응답, 커밋 메시지, 사용자에게 보이는 문구는 한국어로 쓴다. 코드 식별자, 명령, 경로는 원문 그대로 둔다.
- 커밋 메시지는 이 저장소 관례(`<영역>: <한국어 문장>`)를 따른다. 예: `정리: 문제 감지를 걷어낸다`. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 워크트리는 `git worktree add .worktrees/<name> -b feature/<name>`으로 만든다. `EnterWorktree`는 쓰지 않는다(`origin/main`이 로컬 `main`보다 뒤처져 있다).
- `git push`는 하지 않는다. 푸시는 사용자가 한다.
- 남는 이벤트 종류는 `page_view`, `page_leave`, `click`, `scroll` 넷이다.
- 수집 API는 "거절이 아니라 정리한다". 모르는 이벤트나 필드가 와도 배치 전체를 400으로 떨어뜨리지 않는다.
- 로컬 SQLite를 지우거나 비우는 SQL은 명령줄에 쓰지 않는다(`db-migration-guard` 훅이 막는다). 이 계획에서는 DB 파일 자체를 지우고 SQL은 쓰지 않는다.
- 태스크가 끝날 때마다 워크트리 루트에서 `npm run typecheck`와 `npm test`가 모두 통과해야 한다.
- 스키마를 새로 만든다. 옛 DB를 위한 `ALTER TABLE` 마이그레이션은 남기지 않는다.

## 파일 지도

**삭제**
- SDK: `packages/sdk/src/replay/triggers.ts`, `triggers.test.ts`, `buffer.ts`, `buffer.test.ts`
- 서버: `apps/api/src/detection/` 전체(`detect.ts`, `detect.test.ts`, `severity.ts`, `url.ts`, `element-identity.ts`, `element-identity.test.ts`), `apps/api/src/store/dashboard-summary.ts`, `dashboard-summary.test.ts`, `apps/api/src/store/memory-store.ts`, `apps/api/src/screen-hint-budget.test.ts`, `apps/api/src/db/schema.sql`(태스크 4에서 확인 후)
- 관리자: `components/IssueDashboardOverview.tsx`·`.test.tsx`, `components/IssueTable.tsx`·`.test.tsx`, `components/MetricStrip.tsx`, `components/ScreenContextPreview.tsx`·`.test.tsx`, `components/charts/`(3개), `pages/IssueDetailPage.tsx`·`.test.tsx`, `pages/ProjectAuditLogPage.tsx`·`.test.tsx`
- 공유: `packages/shared/src/issue-labels.ts`, `issue-labels.test.ts`
- 문서: `docs/superpowers/specs/` 아래 옛 설계 24개, `docs/superpowers/plans/` 아래 옛 계획 25개

**새로 만듦**
- `apps/api/src/store/element-key.ts`: `detection/element-identity.ts`의 `elementKey`를 옮긴 곳
- `apps/api/src/store/test-store.ts`: 테스트용 `createTestStore()`(SQLite 메모리 DB)

**크게 고침**
- SDK: `client.ts`, `index.ts`, `collectors.ts`, `dom.ts`, `replay/index.ts`, `replay/uploader.ts`와 각 테스트
- 서버: `routes/ingestion.ts`, `routes/admin-proxy.ts`, `routes/admin.ts`, `routes/auth.ts`, `store/types.ts`, `store/sqlite-store.ts`, `db/schema.sqlite.ts`, `startup.ts`와 각 테스트
- 관리자: `App.tsx`, `api.ts`, `storage.ts`, `pages/DashboardPage.tsx`, `pages/ProjectSettingsPage.tsx`, `components/SessionTimeline.tsx`, `pages/pages.css`와 각 테스트
- 공유: `events.ts`, `privacy.ts`, `recording-limits.ts`, `index.ts`와 각 테스트
- `README.md`

---

### Task 0: 작업 워크트리와 기준선

**Files:** 없음(환경 준비)

- [ ] **Step 1: 워크트리를 만든다**

메인 저장소(`/Users/choimiae/workspace/trace`, 브랜치 `main`, HEAD에 이 계획의 설계 커밋이 있어야 한다)에서 실행한다.

```bash
cd /Users/choimiae/workspace/trace
git status --short            # 비어 있어야 한다
git worktree add .worktrees/simplify -b feature/simplify
cd .worktrees/simplify
npm install
```

- [ ] **Step 2: 기준선을 잰다**

```bash
npm run typecheck
npm test 2>&1 | tail -5
```

Expected: 타입 오류 없음, `Test Files  71 passed (71)`, `Tests  1079 passed (1079)`. 숫자가 다르면 그 숫자를 기록해 두고 진행한다. 실패가 있으면 멈추고 보고한다.

---

### Task 1: 옛 설계·계획 문서를 지운다

**Files:**
- Delete: `docs/superpowers/specs/2026-08-*.md`, `docs/superpowers/specs/2026-09-0*.md`, `docs/superpowers/specs/2026-09-1*.md`
- Delete: `docs/superpowers/plans/` 아래에서 이 계획(`2026-09-30-simplify-stage1-removal.md`)을 뺀 전부

- [ ] **Step 1: 지울 목록을 확인한다**

```bash
git ls-files docs/superpowers | grep -v 2026-09-30
```

Expected: 49줄(설계 24, 계획 25). `2026-09-30`이 붙은 설계 문서, 목업 폴더, 이 계획은 목록에 없어야 한다.

- [ ] **Step 2: 지운다**

```bash
git ls-files docs/superpowers | grep -v 2026-09-30 | xargs git rm -q
git ls-files docs/superpowers
```

Expected: 남은 파일은 `specs/2026-09-30-behavior-analytics-redefinition-design.md`, `specs/2026-09-30-mockups/flow.html`, `specs/2026-09-30-mockups/features-sessions.html`, `plans/2026-09-30-simplify-stage1-removal.md` 넷.

- [ ] **Step 3: 옛 문서를 가리키는 링크가 남지 않았는지 본다**

```bash
grep -rn "docs/superpowers/\(specs\|plans\)/2026-0[89]" --include=*.ts --include=*.tsx --include=*.css --include=*.md . | grep -v node_modules | grep -v "^./docs/superpowers/specs/2026-09-30"
```

Expected: `apps/admin/src/styles/tokens.css`의 주석 한 줄(`2026-08-26-admin-ui-refresh-design.md`)과 README의 "스펙과 계획" 절이 나올 수 있다.
- tokens.css: `값의 근거는 docs/superpowers/specs/2026-08-26-admin-ui-refresh-design.md 참고.` 줄을 지운다.
- README "스펙과 계획" 절: 절 제목은 두고, 본문의 옛 문서 목록을 `- 설계: docs/superpowers/specs/2026-09-30-behavior-analytics-redefinition-design.md` 한 줄로 바꾼다. 이 계획 경로는 태스크 9에서 더한다.
- 그 밖의 파일이 나오면 그 링크 줄을 지운다.

- [ ] **Step 4: 커밋한다**

```bash
git add -A docs apps/admin/src/styles/tokens.css README.md
git commit -q -m "정리: 옛 설계·계획 문서를 지운다

제품 재정의 설계(2026-09-30)가 이들을 대체한다. 내용은 git 이력에 남는다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: SDK가 `track()`·JS 오류·화면 맥락을 보내지 않게 한다

**Files:**
- Modify: `packages/sdk/src/client.ts`(`track` 메서드, `redactMetadata` import)
- Modify: `packages/sdk/src/index.ts`(`track` export, `window.trace` 타입과 대입)
- Modify: `packages/sdk/src/collectors.ts`(`getScreenContext` 사용, `error` 리스너, `SAFE_ERROR_*`, `safeError*` 함수)
- Modify: `packages/sdk/src/dom.ts`(화면 맥락·박스 스캔 전부)
- Test: `packages/sdk/src/client.test.ts`, `index.test.ts`, `collectors.test.ts`, `dom.test.ts`

**Interfaces:**
- Produces: `window.trace`는 `{ init, consent }`만 갖는다. `dom.ts`가 export하는 것은 `ElementMetadata`와 `getElementMetadata(element: Element): ElementMetadata` 둘뿐이다. 클릭 이벤트에는 `screenContext`가 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/sdk/src/collectors.test.ts` 맨 아래(가장 바깥 `describe` 안)에 추가한다. 이 파일이 이미 쓰는 클라이언트·fetch 준비 방식을 그대로 따른다. 파일 윗부분의 기존 클릭 테스트가 쓰는 헬퍼 이름이 다르면 그 이름으로 바꾼다.

```ts
it("클릭 이벤트에 화면 맥락을 싣지 않는다", async () => {
  document.body.innerHTML = '<main><button id="save">저장</button></main>';
  const { client, sentEvents } = createCollectingClient();
  installCollectors(client);

  document.querySelector("#save")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await client.flush();

  const click = sentEvents().find((event) => event.type === "click");
  expect(click).toBeDefined();
  expect(click).not.toHaveProperty("screenContext");
});

it("JS 오류를 수집하지 않는다", async () => {
  const { client, sentEvents } = createCollectingClient();
  installCollectors(client);

  window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("x"), filename: "https://app.example.com/a.js", lineno: 3 }));
  await client.flush();

  expect(sentEvents().some((event) => event.type === "js_error")).toBe(false);
});
```

`packages/sdk/src/index.test.ts`에 추가한다.

```ts
it("window.trace 에 track 을 두지 않는다", async () => {
  await import("./index.js");
  expect(window.trace).toBeDefined();
  expect(Object.keys(window.trace!).sort()).toEqual(["consent", "init"]);
});
```

`createCollectingClient`가 이 파일에 없다면 파일 위쪽에 다음 헬퍼를 둔다.

```ts
function createCollectingClient() {
  const bodies: Array<{ events: Array<Record<string, unknown>> }> = [];
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 202 });
  });
  const client = new TraceClient({ projectId: "proj_test", endpoint: "/v1/events/batch", fetcher });
  return { client, sentEvents: () => bodies.flatMap((body) => body.events) };
}
```

(`TraceClient` 생성자가 `fetcher`를 받는 이름이 다르면 `client.ts`의 생성자 옵션 이름에 맞춘다.)

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run packages/sdk/src/collectors.test.ts packages/sdk/src/index.test.ts
```

Expected: 새 테스트 셋이 FAIL(`screenContext`가 있음, `js_error`가 있음, 키에 `track`이 있음).

- [ ] **Step 3: `track()`을 지운다**

- `client.ts`: `track(name, metadata)` 메서드 전체와, 그 메서드만 쓰던 `redactMetadata` import를 지운다.
- `index.ts`: `export function track(...)` 전체를 지우고, `declare global`의 `trace?: { init; track; consent }`를 `trace?: { init: typeof init; consent: typeof consent }`로, 마지막의 `window.trace = { init, track, consent };`를 `window.trace = { init, consent };`로 바꾼다.

- [ ] **Step 4: JS 오류 수집과 화면 맥락을 지운다**

- `collectors.ts`: `SAFE_ERROR_NAME_PATTERN`, `safeErrorName`, `SAFE_ERROR_SOURCE_SHAPE`, `MAX_ERROR_SOURCE_LENGTH`, `safeErrorSource`, `safeErrorLine`과 그 위 주석, `window.addEventListener("error", ...)` 블록을 지운다. 클릭 리스너에서 `const screenContext = getScreenContext(event.target);`와 `...(screenContext ? { screenContext } : {}),`를 지우고, import를 `import { getElementMetadata } from "./dom.js";`로 바꾼다. `redactUrl` import는 `currentPath`가 계속 쓰므로 남긴다.
- `dom.ts`: `ElementMetadata`, `getElementMetadata`와 그것이 부르는 함수(`isTextEntryElement`, `containsTextEntrySubtree`, `allowedElementText`, `TEXT_ENTRY_SUBTREE_SELECTOR`, `CONTENTEDITABLE_SELECTOR`, `buildSelector`와 그 보조 `stableId`·`ancestorChain`·`stableAttributes`·`ANCESTOR_DEPTH`·`STABLE_ATTRIBUTES`·`ATTRIBUTE_VALUE_LIMIT`, 그리고 이들이 쓰는 `@trace/shared` import)만 남기고 나머지를 전부 지운다. 지울 것의 이름: `MAX_SCREEN_RECT`, `MAX_VIEWPORT`, `SAFE_TAG_NAME_PATTERN`, `MAX_LAYOUT_HINTS`, `SKELETON_HINTS`, `MAX_LANDMARK_HINTS`, `MAX_HINT_CANDIDATES`, `MAX_RECT_SCAN`, `MIN_BOX_SIDE`, `SKELETON_MAX_VIEWPORT_RATIO`, `LANDMARK_SELECTOR`, `redactScreenText`, `screenTitle`, `clampRectValue`, `rectFromDomRect`, `clampViewportValue`, `safeRole`, `buildScreenTarget`, `rectCenterDistance`, `ownElementText`, `REPLACED_TAGS`, `hasOwnTextNode`, `isPaintedBox`, `isMaskedHintElement`, `buildLayoutHint`, `offsetRect`, `clampRectToViewport`, `intersectsViewportRect`, `domRectIntersectsViewport`, `scanBoxes`, `FRAME_SELECTOR`, `sameOriginDocument`, `MAX_SCANNED_FRAMES`, `scanFrameBoxes`, `budgetedCandidates`, `isNearSameRect`, `dropNearParent`, `collectLayoutHints`, `getScreenContext`, 그리고 `ScreenRect`·`ScreenViewport`·`ScreenTarget`·`ScreenLayoutHint`·`BoxCandidate` 같은 지역 타입. 남긴 함수가 지운 것을 부르면 타입 검사가 알려 준다.

- [ ] **Step 5: 옛 테스트를 정리한다**

- `client.test.ts`: `track(`을 부르는 테스트는 `track`이 없는 동작을 보는 게 아니면 지운다. 큐·flush·동의를 보려고 `track`을 이벤트 생성 수단으로 쓴 테스트는, `client.enqueue(client.createEvent({ eventId: "evt_test1", type: "click", urlPath: "/", metadata: {} }))`로 바꿔 살린다. `js_error`를 보는 테스트(279·313·351행 근처)와 이벤트 픽스처의 `screenContext` 필드(29행 근처)는 지운다.
- `dom.test.ts`: `describe("getElementMetadata"...)` 계열만 남기고 `getScreenContext`, `isPaintedBox`, `scanBoxes`, `getScreenContext 소비자 계약` describe를 지운다. import를 `import { getElementMetadata } from "./dom.js";`로 줄이고, 더 쓰지 않는 `screenContextSchema` import를 지운다.
- `collectors.test.ts`: `screenContext`나 `js_error`가 있다고 단언하는 기존 테스트를 지운다(Step 1의 새 테스트가 반대 동작을 본다).

- [ ] **Step 6: 통과를 확인한다**

```bash
npx vitest run packages/sdk
npm run typecheck
grep -rn "screenContext\|getScreenContext\|js_error\|track(" packages/sdk/src
```

Expected: 테스트 PASS, 타입 오류 없음. grep은 Step 1에서 쓴 두 테스트의 단언(`not.toHaveProperty("screenContext")`, `"js_error"`)만 나온다.

- [ ] **Step 7: 커밋한다**

```bash
git add -A packages/sdk
git commit -q -m "정리: SDK 에서 track()·JS 오류·화면 맥락 수집을 걷어낸다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 리플레이 트리거를 걷어내고 기록 시작부터 올린다

**Files:**
- Delete: `packages/sdk/src/replay/triggers.ts`, `triggers.test.ts`, `buffer.ts`, `buffer.test.ts`
- Modify: `packages/sdk/src/replay/index.ts`
- Modify: `packages/sdk/src/replay/uploader.ts`(`RecordedEvent` 타입을 이리로 옮긴다)
- Modify: `packages/shared/src/recording-limits.ts`(`BUFFERED_CHECKPOINT_GENERATIONS` 삭제)
- Test: `packages/sdk/src/replay/index.test.ts`, `index.integration.test.ts`, `uploader.test.ts`

**Interfaces:**
- Produces: `export interface RecordedEvent { type: number; timestamp: number; [key: string]: unknown }`가 `replay/uploader.ts`에 있다. `startReplay(config, { uploader? })`는 기록을 시작하자마자 10초(`UPLOAD_INTERVAL_MS`)마다, 그리고 `pagehide` 때 대기 중인 이벤트를 업로더에 넘긴다.

- [ ] **Step 1: 기존 "트리거 전" 테스트를 반대 동작으로 바꾼다**

`packages/sdk/src/replay/index.test.ts`에서 `it("트리거 전에는 업로더에 아무것도 넣지 않는다", ...)`와 `it("분노 클릭이 걸리면 버퍼를 비워 올린다", ...)`를 지우고 다음 둘로 바꾼다. 파일 상단 `describe` 안의 `beforeEach`에 `vi.useFakeTimers();`, `afterEach`에 `vi.useRealTimers();`를 더한다.

```ts
it("트리거 없이도 주기마다 기록을 올린다", () => {
  const uploader = { enqueue: vi.fn(), flush: vi.fn(async () => true) };
  startReplay(config, { uploader });
  const emit = (record.mock.calls[0]![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;

  emit({ type: 4, timestamp: 1, data: {} });
  emit({ type: 2, timestamp: 2, data: {} }, true);
  vi.advanceTimersByTime(10_000);

  expect(uploader.enqueue).toHaveBeenCalledTimes(1);
  expect(uploader.enqueue.mock.calls[0]![0]).toHaveLength(2);
  expect(uploader.flush).toHaveBeenCalledTimes(1);
});

it("페이지를 떠날 때 남은 기록을 keepalive 로 올린다", () => {
  const uploader = { enqueue: vi.fn(), flush: vi.fn(async () => true) };
  startReplay(config, { uploader });
  const emit = (record.mock.calls[0]![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;

  emit({ type: 2, timestamp: 1, data: {} }, true);
  window.dispatchEvent(new Event("pagehide"));

  expect(uploader.enqueue).toHaveBeenCalledWith([expect.objectContaining({ timestamp: 1 })]);
  expect(uploader.flush).toHaveBeenLastCalledWith({ keepalive: true });
});
```

`packages/sdk/src/replay/index.integration.test.ts`의 `it("트리거 전에는 아무것도 업로더에 넘기지 않는다", ...)`를 다음으로 바꾼다.

```ts
it("배선된 채로 첫 스냅샷부터 업로더에 넘긴다", async () => {
  const uploader = { enqueue: vi.fn(), flush: vi.fn(async () => true) };

  document.body.innerHTML = '<div class="note">주문</div>';
  const stop = startReplay(config, { uploader });
  window.dispatchEvent(new Event("pagehide"));

  const sent = uploader.enqueue.mock.calls.flatMap((call) => call[0] as Array<{ type: number }>);
  expect(sent.some((event) => event.type === 2)).toBe(true);

  stop();
  document.body.innerHTML = "";
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run packages/sdk/src/replay/index.test.ts packages/sdk/src/replay/index.integration.test.ts
```

Expected: 새 테스트 셋이 FAIL(업로더가 불리지 않음).

- [ ] **Step 3: `RecordedEvent`를 옮기고 버퍼·트리거를 지운다**

- `replay/uploader.ts`: `import type { RecordedEvent } from "./buffer.js";`를 지우고 그 자리에 다음을 둔다.

```ts
export interface RecordedEvent {
  type: number;
  timestamp: number;
  [key: string]: unknown;
}
```

- `replay/uploader.test.ts`: `import type { RecordedEvent } from "./buffer.js";`를 `import type { RecordedEvent } from "./uploader.js";`로 바꾼다.
- `git rm packages/sdk/src/replay/triggers.ts packages/sdk/src/replay/triggers.test.ts packages/sdk/src/replay/buffer.ts packages/sdk/src/replay/buffer.test.ts`
- `packages/shared/src/recording-limits.ts`: `BUFFERED_CHECKPOINT_GENERATIONS`와 그 주석을 지운다. `recording-limits.test.ts`에 이 상수를 보는 단언이 있으면 지운다.

- [ ] **Step 4: `startReplay`를 고친다**

`replay/index.ts`에서:
- import를 `import { maskText, redactEventText, redactEventUrl, stripDataUris } from "./mask.js";`와 `import { RecordingUploader, type RecordedEvent } from "./uploader.js";`로 정리한다(`CheckpointBuffer`, `installTriggers` import 삭제).
- `INCREMENTAL_SNAPSHOT`, `MUTATION_SOURCE` 상수를 지운다.
- `startReplay` 본문의 `const buffer = new CheckpointBuffer();`, `let triggered = false;`, `const triggers = installTriggers(...)` 블록을 지우고 다음으로 바꾼다.

```ts
  // 기록은 시작부터 계속 올린다. 모든 세션을 재생할 수 있어야 한다(제품 재정의
  // 2026-09-30). 대기열은 다음 주기까지 쌓인 이벤트뿐이다.
  let pending: RecordedEvent[] = [];
  const drain = (): RecordedEvent[] => {
    const drained = pending;
    pending = [];
    return drained;
  };
  const uploadTimer = setInterval(() => {
    uploader.enqueue(drain());
    void uploader.flush();
  }, UPLOAD_INTERVAL_MS);
```

- `emit` 안의 `buffer.push(recorded, isCheckout === true);`를 `pending.push(recorded);`로 바꾸고, 그 아래 `const data = ...`부터 `triggers.notifyMutation();`을 닫는 `if` 블록까지 지운다. `emit(event: unknown, isCheckout?: boolean)` 시그니처는 `emit(event: unknown)`으로 줄인다.
- `onPageHide`를 다음으로 바꾼다.

```ts
  const onPageHide = () => {
    uploader.enqueue(drain());
    // 페이지를 떠나는 마지막 한 번만 keepalive 다.
    void uploader.flush({ keepalive: true });
  };
```

- 반환하는 정리 함수를 다음으로 바꾼다.

```ts
  return () => {
    stopRecording?.();
    window.removeEventListener("pagehide", onPageHide);
    clearInterval(uploadTimer);
  };
```

- `overrides.uploader` 위의 주석 `// 주입 지점을 둔 이유는 "트리거 전에는 아무것도 전송되지 않는다" 를 ...`을 `// 주입 지점은 업로드 시점을 단위 테스트로 보기 위한 것이다. 실제 실행에서는 언제나 아래 기본값이 쓰인다.`로 바꾼다.
- `index.test.ts` 상단의 `// 트리거가 뒤 테스트의 클릭에 같이 반응해 ...` 주석을 `// 앞 테스트의 pagehide 리스너·타이머가 뒤 테스트에 섞이지 않게 한다.`로 바꾼다.

- [ ] **Step 5: 통과를 확인한다**

```bash
npx vitest run packages/sdk packages/shared
npm run typecheck
grep -rn "trigger\|Trigger\|CheckpointBuffer\|BUFFERED_CHECKPOINT" packages apps --include=*.ts -l | grep -v node_modules
```

Expected: PASS, 타입 오류 없음, grep 결과 없음. (`--include`를 zsh가 먼저 펼쳐 오류가 나면 `grep -rln ... packages apps | grep -v node_modules | grep "\.ts$"`로 돌린다.)

- [ ] **Step 6: 커밋한다**

```bash
git add -A packages
git commit -q -m "리플레이: 트리거를 걷어내고 기록 시작부터 올린다

모든 세션을 재생할 수 있어야 한다. 문제가 난 세션만 올리던 롤링 버퍼와
헛클릭·연타·오류 트리거를 지운다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 서버에서 문제 감지와 화면 맥락을 걷어낸다

**Files:**
- Delete: `apps/api/src/detection/detect.ts`, `detect.test.ts`, `severity.ts`, `url.ts`, `element-identity.test.ts`, `apps/api/src/store/dashboard-summary.ts`, `dashboard-summary.test.ts`, `apps/api/src/screen-hint-budget.test.ts`
- Move: `apps/api/src/detection/element-identity.ts` → `apps/api/src/store/element-key.ts`(`elementKey`만 남김)
- Modify: `apps/api/src/routes/ingestion.ts`, `apps/api/src/routes/admin-proxy.ts`, `apps/api/src/store/types.ts`, `sqlite-store.ts`, `memory-store.ts`, `apps/api/src/db/schema.sqlite.ts`
- Test: `apps/api/src/routes/ingestion.test.ts`, `admin.test.ts`, `store/store-contract.test.ts`, `store/sqlite-store.test.ts`

**Interfaces:**
- Consumes: 태스크 2의 SDK(클릭에 `screenContext` 없음, `js_error` 없음)
- Produces: `TraceStore`에서 `listEvents`, `upsertIssues`, `listIssues`, `getIssue`, `findScreenContextEvents`, `getDashboardSummary`가 사라진다. `types.ts`에서 `SCREEN_CONTEXT_CANDIDATE_LIMIT`, `pickRepresentativeScreenContextEvent`, `ScreenContextEventQuery`가 사라진다. `store/element-key.ts`가 `export function elementKey(event: TraceEvent): string | undefined`를 준다. 수집 API는 `page_view`·`page_leave`·`click`·`scroll`이 아닌 이벤트를 조용히 버린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/routes/ingestion.test.ts`에 추가한다. 파일에 이미 있는 배치 생성 헬퍼와 프로젝트 준비 방식을 따른다. 아래는 헬퍼가 없을 때의 완전한 형태다.

```ts
it("모르는 종류의 이벤트는 버리고 나머지를 저장한다", async () => {
  const store = new MemoryStore();
  const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });
  const app = createApp({ store });

  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { origin: "https://app.example.com" },
    payload: {
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-30T00:00:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://app.example.com/quote",
      events: [
        { eventId: "evt_1", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:00.000Z", type: "js_error", urlPath: "/quote", metadata: {} },
        { eventId: "evt_2", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:01.000Z", type: "click", urlPath: "/quote", metadata: {} },
      ],
    },
  });

  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ accepted: 1 });
  const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
  expect(timeline.map((event) => event.type)).toEqual(["click"]);
  await app.close();
});

it("남는 이벤트가 없어도 202 로 받는다", async () => {
  const store = new MemoryStore();
  const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });
  const app = createApp({ store });

  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { origin: "https://app.example.com" },
    payload: {
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-30T00:00:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://app.example.com/quote",
      events: [
        { eventId: "evt_1", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:00.000Z", type: "custom_event", urlPath: "/quote", metadata: {} },
      ],
    },
  });

  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ accepted: 0 });
  await app.close();
});

it("화면 맥락과 오류 필드는 저장하지 않는다", async () => {
  const store = new MemoryStore();
  const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });
  const app = createApp({ store });

  await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { origin: "https://app.example.com" },
    payload: {
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-30T00:00:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://app.example.com/quote",
      events: [
        {
          eventId: "evt_1", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:00.000Z",
          type: "click", urlPath: "/quote", metadata: {},
          errorName: "TypeError", screenContext: { viewport: { width: 100, height: 100 }, layoutHints: [] },
        },
      ],
    },
  });

  const [click] = await store.getSessionTimeline(project.projectId, "sess_1");
  expect(click).toBeDefined();
  expect(click).not.toHaveProperty("screenContext");
  expect(click).not.toHaveProperty("errorName");
  await app.close();
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run apps/api/src/routes/ingestion.test.ts
```

Expected: 새 테스트 셋이 FAIL(첫 둘은 400, 셋째는 필드가 남음).

- [ ] **Step 3: 수집 API를 고친다**

`apps/api/src/routes/ingestion.ts`에서:
- 파일 위에 둔다.

```ts
// 제품 재정의(2026-09-30)에서 남긴 이벤트 종류. 옛 SDK 가 보내는 다른 종류는
// 배치를 떨어뜨리지 않고 버린다 — 수집 API 는 거절이 아니라 정리한다.
const KEPT_EVENT_TYPES: ReadonlySet<string> = new Set(["page_view", "page_leave", "click", "scroll"]);
```

- `rawTraceEventSchema`에서 `type: eventTypeSchema,`를 `type: z.string(),`로 바꾸고 `errorName`, `errorSource`, `errorLine`, `screenContext` 필드를 지운다(zod 기본 동작이 모르는 키를 떨어뜨린다).
- 핸들러에서 `sanitizedBatch`를 만들기 전에 거른다.

```ts
      const keptEvents = rawBatch.events.filter((event) => KEPT_EVENT_TYPES.has(event.type));
      if (keptEvents.length === 0) return reply.code(202).send({ accepted: 0 });
```

그리고 `events: rawBatch.events.map(...)`를 `events: keptEvents.map(...)`로 바꾼다. `sanitizeEvent`의 첫 인자 타입이 `type: string`을 받게 되므로, 반환 객체의 `type`은 `event.type as TraceEvent["type"]`로 넘긴다.
- `saveBatch` 뒤의 `listEvents`·`detectIssues`·`upsertIssues` 세 줄을 지운다.
- `sanitizeEvent`에서 `errorName`·`errorSource`·`errorLine`·`screenContext` 계산과 전개를 지운다. `SAFE_ERROR_NAME_PATTERN`, `SAFE_ERROR_SOURCE_PATTERN`, `sanitizeErrorName`, `sanitizeErrorSource`, `sanitizeErrorLine`, `sanitizeScreenContext`, `sanitizeScreenElement`, `sanitizeScreenText`, `clampRectValue`, `clampViewportValue`와 그 주석을 지운다. `sanitizeViewportDimension`은 클릭의 `viewportX/Y`가 계속 쓰므로 남긴다.
- import에서 `screenContextSchema`, `ScreenContext`, `detectIssues`, `eventTypeSchema`(더 쓰지 않으면)를 지운다.

- [ ] **Step 4: 저장소와 스키마에서 문제·화면 맥락을 지운다**

- `apps/api/src/store/element-key.ts`를 만든다.

```ts
import { hash64Hex, type TraceEvent } from "@trace/shared";

// 기능 하나를 가리키는 키. 선택자 해시만으로는 부족하다 — 구조와 속성이 같고
// 적힌 글자만 다른 버튼이 나란히 놓이는 일이 흔하다. 글자는 이미 마스킹·절단돼
// 저장되므로 새로 모을 것이 없다. 구분자는 마스킹된 글자에 나올 수 없는 NUL 이라
// 두 필드의 경계가 겹치지 않는다.
export function elementKey(event: TraceEvent): string | undefined {
  if (!event.elementSelectorHash) return undefined;
  return hash64Hex(`${event.elementSelectorHash}\u0000${event.elementTextMaskedOrLimited ?? ""}`);
}
```

- `git rm -r apps/api/src/detection apps/api/src/store/dashboard-summary.ts apps/api/src/store/dashboard-summary.test.ts apps/api/src/screen-hint-budget.test.ts`
- `sqlite-store.ts`의 `import { elementKey } from "../detection/element-identity.js";`를 `import { elementKey } from "./element-key.js";`로 바꾼다. `store-contract.test.ts`의 같은 import도 바꾼다.
- `types.ts`: `SCREEN_CONTEXT_CANDIDATE_LIMIT`, `pickRepresentativeScreenContextEvent`, `ScreenContextEventQuery`, 그리고 `TraceStore`의 `listEvents`, `upsertIssues`, `listIssues`, `getIssue`, `findScreenContextEvents`, `getDashboardSummary`를 지운다. import에서 `DashboardSummary`, `Issue`를 지운다.
- `sqlite-store.ts`와 `memory-store.ts`: 위 여섯 메서드의 구현과, 그것만 쓰던 보조 함수·행 변환기(`rowToIssue` 류, `issues` 테이블을 읽고 쓰는 SQL)를 지운다. `saveBatch`의 INSERT에서 `screen_context`, `error_name`, `error_source`, `error_line` 열과 값을 지우고, 행 → 이벤트 변환에서 같은 필드를 지운다. `sqlite-store.ts`의 `migrate()` 메서드와 그 호출(`this.migrate();`)과 `hasColumn` 보조 함수를 지운다(스키마를 새로 만든다).
- `schema.sqlite.ts`: `events`에서 `screen_context`, `error_name`, `error_source`, `error_line` 열을 지우고, `issues` 테이블과 `issues_project_severity` 인덱스를 지운다. 맨 위 주석의 MemoryStore 언급은 태스크 6에서 고친다.
- `apps/api/src/db/schema.sql`: `grep -rn "schema.sql" apps/api` 로 참조를 확인한다. 참조가 없으면 `git rm`한다. 참조가 있으면 `schema.sqlite.ts`와 같은 변경을 한다.

- [ ] **Step 5: 관리자 API에서 문제 라우트를 지운다**

`apps/api/src/routes/admin-proxy.ts`에서:
- `GET /admin/api/projects/:projectId/summary`, `GET /admin/api/projects/:projectId/issues`, `GET /admin/api/issues/:issueId` 라우트를 지운다.
- `attachRepresentativeEvents`, `REPRESENTATIVE_EVENT_TYPES`, `REPRESENTATIVE_LEAD_IN_MS`, `ELEMENT_FILTERED_ISSUE_TYPES`, `findRepresentativeEvent`, `representativeWindowStart`와 그 주석, `issueParamsSchema`를 지운다.
- `ProjectResourceType`에서 `"issue"`, `"summary"`, `"issues"`처럼 지운 라우트만 쓰던 값을 지운다(타입 검사가 알려 준다).
- import에서 `Issue`, `TraceEvent`(더 쓰지 않으면)를 지운다.

- [ ] **Step 6: 옛 테스트를 정리한다**

- `ingestion.test.ts`: `listIssues`·`getIssue`·이슈 생성을 단언하는 테스트, `screenContext`·`errorName`·`errorSource`·`errorLine`이 저장된다고 단언하는 테스트를 지운다.
- `admin.test.ts`: `/summary`, `/issues`, `/admin/api/issues/` 를 부르는 테스트를 지운다.
- `store-contract.test.ts`: `upsertIssues`, `listIssues`, `getIssue`, `findScreenContextEvents`, `getDashboardSummary`, `listEvents`, `SCREEN_CONTEXT_CANDIDATE_LIMIT`, `screenContext`, `errorName`을 쓰는 `it`을 지운다. import에서 `SCREEN_CONTEXT_CANDIDATE_LIMIT`을 지운다.
- `sqlite-store.test.ts`: 옛 스키마에서 열을 더하는 마이그레이션을 보는 테스트(`ALTER TABLE`, `migrate`, 옛 이슈 정리)를 지운다.

- [ ] **Step 7: 통과를 확인한다**

```bash
npx vitest run apps/api
npm run typecheck
grep -rn "detectIssues\|upsertIssues\|listIssues\|getDashboardSummary\|findScreenContextEvents\|screen_context\|screenContext\|issueTargetKey" apps/api/src
```

Expected: PASS, 타입 오류 없음. grep은 Step 1의 새 테스트(`screenContext`를 보내고 없다고 단언)만 나온다.

- [ ] **Step 8: 커밋한다**

```bash
git add -A apps/api
git commit -q -m "정리: 서버에서 문제 감지와 화면 맥락을 걷어낸다

수집 API 는 남긴 네 종류가 아닌 이벤트를 배치를 떨어뜨리지 않고 버린다.
요소 키는 기능 식별 용도로 store/element-key.ts 로 옮긴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 서버에서 멤버·역할·감사 로그를 걷어낸다

**Files:**
- Modify: `apps/api/src/store/types.ts`, `sqlite-store.ts`, `memory-store.ts`, `apps/api/src/db/schema.sqlite.ts`
- Modify: `apps/api/src/routes/admin-proxy.ts`, `routes/admin.ts`, `routes/auth.ts`
- Test: `apps/api/src/store/store-contract.test.ts`, `routes/admin.test.ts`, `routes/auth.test.ts`, `routes/admin-recording.test.ts`

**Interfaces:**
- Produces:
  - `TraceStore.listProjects(): Promise<ProjectRecord[]>` — `createdAt` 오름차순, 같으면 `projectId` 오름차순
  - `GET /auth/me`의 `projects`는 `Array<{ projectId: string }>`이고 모든 프로젝트를 담는다(역할 없음)
  - `GET /admin/api/projects/:projectId` 응답에 `role`이 없다
  - 로그인한 관리자는 누구든 모든 프로젝트를 읽고 고칠 수 있다. 없는 프로젝트는 404다
  - 사라지는 것: `searchAdminUsers`, `addProjectMembership`, `addProjectMembershipWithAudit`, `updateProjectMembershipRoleWithAudit`, `removeProjectMembershipWithAudit`, `getProjectMembership`, `listProjectMembershipsForUser`, `listProjectMemberships`, `createAuditLog`, `listAuditLogs`, `listProjectAuditLogs`, 타입 `AdminRole`, `ProjectMembershipRecord`, `AuditLogRecord`, `AddProjectMembershipInput`, `CreateAuditLogInput`, `ProjectMembershipAuditLogFactory`, 라우트 `GET/POST /admin/api/projects/:projectId/members`, `PATCH/DELETE /admin/api/projects/:projectId/members/:adminUserId`, `GET .../member-candidates`, `GET .../audit-logs`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`store-contract.test.ts`의 `describeTraceStoreContract` 안에 추가한다.

```ts
it("모든 프로젝트를 만든 순서대로 돌려준다", async () => {
  const store = open();
  const first = await store.createProject({ name: "첫째", allowedDomains: ["https://a.example.com"] });
  const second = await store.createProject({ name: "둘째", allowedDomains: ["https://b.example.com"] });

  const projects = await store.listProjects();

  expect(projects.map((project) => project.projectId)).toEqual([first.projectId, second.projectId]);
});
```

`routes/admin.test.ts`에 추가한다. 파일에 이미 있는 "로그인한 관리자 쿠키 만들기" 헬퍼(예: `loginAs`, `createAuthenticatedApp` 등 이 파일이 쓰는 이름)를 쓴다. 두 관리자 이메일이 모두 `ADMIN_ALLOWED_EMAILS`에 들어 있는 설정을 쓴다.

```ts
it("다른 관리자가 만든 프로젝트도 읽고 고칠 수 있다", async () => {
  const { app, store, cookieFor } = await setupTwoAdmins(["owner@example.com", "other@example.com"]);
  const created = await store.createProject({ name: "업무시스템", allowedDomains: ["https://app.example.com"] });
  const other = await cookieFor("other@example.com");

  const read = await app.inject({ method: "GET", url: `/admin/api/projects/${created.projectId}`, headers: other.headers });
  expect(read.statusCode).toBe(200);
  expect(read.json()).not.toHaveProperty("role");

  const patched = await app.inject({
    method: "PATCH",
    url: `/admin/api/projects/${created.projectId}`,
    headers: other.headersWithCsrf,
    payload: { name: "업무시스템2", allowedDomains: ["https://app.example.com"] },
  });
  expect(patched.statusCode).toBe(200);
  await app.close();
});

it("없는 프로젝트는 404 다", async () => {
  const { app, cookieFor } = await setupTwoAdmins(["owner@example.com"]);
  const owner = await cookieFor("owner@example.com");

  const response = await app.inject({ method: "GET", url: "/admin/api/projects/proj_missing", headers: owner.headers });
  expect(response.statusCode).toBe(404);
  await app.close();
});
```

`setupTwoAdmins`가 없으면 이 파일의 기존 인증 준비 코드(쿠키 발급, CSRF 헤더)를 감싸서 같은 이름으로 만든다. 반환값: `app`, `store`, `cookieFor(email) => Promise<{ headers: Record<string,string>; headersWithCsrf: Record<string,string> }>`.

`routes/auth.test.ts`에 추가한다(이 파일의 기존 로그인 흐름 헬퍼를 쓴다).

```ts
it("/auth/me 는 모든 프로젝트를 역할 없이 돌려준다", async () => {
  const { app, store, loginCookie } = await setupLoggedIn();
  const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });

  const response = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: loginCookie } });

  expect(response.statusCode).toBe(200);
  expect(response.json().projects).toEqual([{ projectId: project.projectId }]);
  await app.close();
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run apps/api/src/store/store-contract.test.ts apps/api/src/routes/admin.test.ts apps/api/src/routes/auth.test.ts
```

Expected: "모든 프로젝트를 만든 순서대로"(`listProjects` 없음), "다른 관리자가 만든 프로젝트도"(403 `project_access_denied`), "/auth/me 는 모든 프로젝트를"(`projects`가 빈 배열이거나 `role`이 붙음)이 FAIL. "없는 프로젝트는 404 다"는 지금도 통과할 수 있다 — 권한 검사를 바꾼 뒤에도 404가 유지되는지 지키는 테스트다.

- [ ] **Step 3: 저장소를 고친다**

- `types.ts`: Interfaces의 "사라지는 것" 타입과 메서드를 지우고 `listProjects(): Promise<ProjectRecord[]>;`를 `getProject` 옆에 더한다.
- `sqlite-store.ts`에 구현한다(이 파일이 쓰는 행 → `ProjectRecord` 변환 함수 이름을 그대로 쓴다).

```ts
  async listProjects(): Promise<ProjectRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY created_at ASC, project_id ASC")
      .all() as ProjectRow[];
    return rows.map(toProjectRecord);
  }
```

- `memory-store.ts`에 구현한다.

```ts
  async listProjects(): Promise<ProjectRecord[]> {
    return [...this.projects.values()].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.projectId.localeCompare(right.projectId),
    );
  }
```

(`this.projects`의 실제 필드 이름에 맞춘다.)
- 두 저장소에서 사라지는 메서드의 구현과 그것만 쓰던 보조 코드를 지운다.
- `schema.sqlite.ts`: `project_memberships`, `audit_logs` 테이블과 `audit_logs_project_created` 인덱스를 지운다.

- [ ] **Step 4: 라우트를 고친다**

`routes/admin-proxy.ts`:
- Interfaces의 사라지는 라우트 여섯 개를 지운다.
- `POST /admin/api/projects`에서 `addProjectMembership` 호출과 `createAuditLog` 호출을 지운다.
- `PATCH /admin/api/projects/:projectId`에서 `access.membership.role === "viewer"` 검사와 `createAuditLog` 호출을 지우고, 응답을 `toProjectSettingsResponse(updated)`로 바꾼다.
- `getProjectAccess`를 다음으로 바꾼다.

```ts
async function getProjectAccess(
  store: TraceStore,
  projectId: string,
): Promise<ProjectAccess | ProjectAccessError> {
  const project = await store.getProject(projectId);
  if (!project) return { statusCode: 404, error: "project_not_found" };
  return { project };
}
```

`ProjectAccess` 타입을 `{ project: ProjectRecord }`로 줄이고, 호출하는 곳의 인자(`authenticated`, `resourceType`)를 지운다. `ProjectResourceType`이 더 쓰이지 않으면 지운다.
- `toProjectSettingsResponse(project)`에서 `role` 인자와 응답의 `role` 필드를 지운다.
- `auditProjectAccessDenied`, `sendProjectMemberMutationError`, `toProjectMemberResponse`, `encodeAuditLogCursor`, `parseAuditLogCursor`, `resolveAuditLogActors`, 응답 타입 `ProjectMemberResponse`·`ProjectMemberCandidateResponse`·`ProjectAuditLogActorResponse`·`ProjectAuditLogEntryResponse`, `projectMemberParamsSchema`를 지운다.

`routes/admin.ts`: `addProjectMemberSchema`, `updateProjectMemberRoleSchema`, `memberCandidateSearchSchema`, `auditLogQuerySchema`를 지운다.

`routes/auth.ts`:
- `createAuditLog` 호출 네 곳과 `auditLoginFailure` 함수를 지운다. `auditLoginFailure(...)`를 부르던 곳은 그 줄만 지운다.
- `/auth/me`에서 `listProjectMembershipsForUser`를 다음으로 바꾼다.

```ts
    const projects = await options.store.listProjects();
```

응답의 `projects: memberships.map(...)`을 `projects: projects.map(({ projectId }) => ({ projectId })),`로 바꾼다. `AuthMeResponse` 타입의 `projects` 항목에서 `role`을 지운다.

- [ ] **Step 5: 옛 테스트를 정리한다**

- `admin.test.ts`: 멤버·후보·감사 로그 라우트 테스트, `project_role_forbidden`·`project_access_denied`를 기대하는 테스트, `LastOwnerStore`·`RequesterRoleRaceStore`·`TargetRoleRaceStore`·`SaveTimeDuplicateStore`·`CountingAdminUserStore` 중 지운 기능만 보던 클래스와 테스트를 지운다(남는 테스트가 쓰는 클래스는 남긴다).
- `store-contract.test.ts`: 멤버십·감사 로그·`searchAdminUsers` 테스트를 지운다.
- `auth.test.ts`: 감사 로그 기록을 단언하는 테스트와 `projects`에 `role`을 기대하는 단언을 지우거나 새 모양으로 바꾼다.
- `admin-recording.test.ts`: 테스트 준비에서 `addProjectMembership`을 부르면 그 줄을 지운다(이제 로그인만 하면 접근된다). 멤버가 아니라 403을 기대하는 테스트는 지운다.

- [ ] **Step 6: 통과를 확인한다**

```bash
npx vitest run apps/api
npm run typecheck
grep -rn "Membership\|AuditLog\|audit_log\|AdminRole\|project_role_forbidden\|project_access_denied\|searchAdminUsers\|member-candidates" apps/api/src
```

Expected: PASS, 타입 오류 없음, grep 결과 없음.

- [ ] **Step 7: 커밋한다**

```bash
git add -A apps/api
git commit -q -m "정리: 서버에서 멤버·역할·감사 로그를 걷어낸다

허용 이메일로 로그인한 관리자는 모든 프로젝트를 보고 고친다.
/auth/me 는 모든 프로젝트를 역할 없이 돌려준다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 메모리 저장소를 걷어내고 테스트를 SQLite 메모리 DB로 옮긴다

**Files:**
- Delete: `apps/api/src/store/memory-store.ts`
- Create: `apps/api/src/store/test-store.ts`
- Modify: `apps/api/src/store/types.ts`(`isDurable`, `assertDeployableTraceStore`), `sqlite-store.ts`(`isDurable`), `apps/api/src/startup.ts`, `apps/api/src/db/schema.sqlite.ts`(주석)
- Test: `MemoryStore`를 쓰는 모든 테스트(`startup.test.ts`, `auth/session.test.ts`, `retention/recordings.test.ts`, `retention/sweeper.test.ts`, `retention/events.test.ts`, `routes/recording.test.ts`, `routes/ingestion.test.ts`, `routes/auth.test.ts`, `routes/project-config.test.ts`, `routes/admin.test.ts`, `routes/admin-recording.test.ts`, `store/store-contract.test.ts`)

**Interfaces:**
- Produces: `export function createTestStore(): SqliteStore` — `new SqliteStore(":memory:")`. `TraceStore`에 `isDurable`이 없고, `assertDeployableTraceStore`가 없다.

- [ ] **Step 1: 테스트 저장소를 만든다**

`apps/api/src/store/test-store.ts`:

```ts
import { SqliteStore } from "./sqlite-store.js";

// 테스트용 저장소. 저장소 구현은 SQLite 하나뿐이고, 테스트는 파일 없이 메모리 DB 를 쓴다.
export function createTestStore(): SqliteStore {
  return new SqliteStore(":memory:");
}
```

- [ ] **Step 2: 테스트의 `MemoryStore`를 바꾼다**

import 경로는 세 모양이다: `routes/`·`retention/`·`auth/` 아래는 `"../store/memory-store.js"`, `src/` 바로 아래(`startup.test.ts`)는 `"./store/memory-store.js"`, `store/` 안은 `"./memory-store.js"`.

```bash
grep -rl "MemoryStore" apps/api/src | grep "\.test\.ts$" | while read file; do
  sed -i '' \
    -e 's#import { MemoryStore } from "\.\./store/memory-store.js";#import { createTestStore } from "../store/test-store.js";#' \
    -e 's#import { MemoryStore } from "\./store/memory-store.js";#import { createTestStore } from "./store/test-store.js";#' \
    -e 's#import { MemoryStore } from "\./memory-store.js";#import { createTestStore } from "./test-store.js";#' \
    -e 's/new MemoryStore()/createTestStore()/g' \
    "$file"
done
grep -rn "MemoryStore" apps/api/src
```

Expected: 남은 줄은 타입 위치의 `MemoryStore`(예: `function createRecordingApp(store: MemoryStore, ...)`, `class X extends MemoryStore`)뿐이다. 타입 위치는 `SqliteStore`로 바꾸고 `import type { SqliteStore } from "../store/sqlite-store.js";`(위치에 맞게)를 더한다. `class X extends MemoryStore`는 `class X extends SqliteStore { constructor() { super(":memory:"); } }`로 바꾼다.

- [ ] **Step 3: 계약 테스트와 배포 검사를 정리한다**

- `store-contract.test.ts`: `describeTraceStoreContract("MemoryStore", ...)` 줄을 지운다. 세 번째 인자 `expectedDurable`와 그것을 보는 `it`(`assertDeployableTraceStore`, `isDurable`)을 지우고, 함수 시그니처를 `describeTraceStoreContract(name: string, createStore: () => StoreUnderTest)`로 줄인다.
- `types.ts`: `readonly isDurable?: boolean;`와 `assertDeployableTraceStore`를 지운다.
- `sqlite-store.ts`: `readonly isDurable = true;`를 지운다.
- `startup.ts`: `assertDeployableTraceStore` import와 호출을 지운다. `prepareServerStartup`의 `store` 입력이 더 쓰이지 않으면 입력에서 빼고 `server.ts`의 호출도 맞춘다.
- `startup.test.ts`: `durableMemoryStore`와 "운영 환경에서 비영속 저장소를 거부한다" 류 테스트를 지운다. 남는 테스트의 `store:` 인자는 앞 항목에 맞춘다.
- `schema.sqlite.ts` 맨 위 주석에서 `// REFERENCES 절을 넣지 않는다. MemoryStore가 ...` 두 줄을 `// REFERENCES 절은 넣지 않는다. 보존 스윕이 테이블마다 따로 지운다.`로 바꾼다.
- `git rm apps/api/src/store/memory-store.ts`

- [ ] **Step 4: 통과를 확인한다**

```bash
npx vitest run apps/api
npm run typecheck
grep -rn "MemoryStore\|memory-store\|isDurable\|assertDeployableTraceStore" apps packages --include=*.ts | grep -v node_modules
```

Expected: PASS, 타입 오류 없음, grep 결과 없음. 테스트 중 SQLite 동작 차이로 실패하는 것이 있으면(예: 정렬, 시각 비교) 테스트의 기대가 SQLite 쪽 계약과 맞는지 보고, 계약 테스트(`store-contract.test.ts`)에 같은 기대가 있으면 그쪽이 정답이다.

- [ ] **Step 5: 커밋한다**

```bash
git add -A apps/api
git commit -q -m "정리: 메모리 저장소를 걷어내고 테스트를 SQLite 메모리 DB 로 옮긴다

저장소 구현을 하나로 둔다. 비영속 저장소를 막던 배포 검사도 함께 지운다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 관리자 화면에서 문제·미리보기·멤버·감사 로그를 걷어낸다

**Files:**
- Delete: `apps/admin/src/components/IssueDashboardOverview.tsx`·`.test.tsx`, `IssueTable.tsx`·`.test.tsx`, `MetricStrip.tsx`, `ScreenContextPreview.tsx`·`.test.tsx`, `components/charts/`(`FrictionTrendChart.tsx`, `IssueTypeChart.tsx`, `IssueTypeChart.test.tsx`), `pages/IssueDetailPage.tsx`·`.test.tsx`, `pages/ProjectAuditLogPage.tsx`·`.test.tsx`
- Modify: `apps/admin/src/App.tsx`, `api.ts`, `storage.ts`, `pages/DashboardPage.tsx`, `pages/ProjectSettingsPage.tsx`, `components/SessionTimeline.tsx`, `pages/pages.css`
- Test: `apps/admin/src/App.test.tsx`, `App.loading.test.tsx`, `pages/DashboardPage.test.tsx`, `pages/ProjectSettingsPage.test.tsx`, `components/SessionTimeline.test.tsx`, `storage.test.ts`

**Interfaces:**
- Consumes: 태스크 5의 API(`/auth/me`의 `projects: {projectId}[]`, 설정 응답에 `role` 없음, 멤버·감사 라우트 없음), 태스크 4의 API(`/summary`, `/issues`, `/admin/api/issues/:id` 없음)
- Produces:
  - `api.ts`의 `ProjectOption`과 `AuthMeResponse.projects` 항목은 `{ projectId: string }`
  - `api.ts`에서 사라지는 것: `ProjectRole`, `ProjectMemberResponse`, `AddProjectMemberInput`, `getProjectMembers`, `ProjectMemberCandidateResponse`, `searchProjectMemberCandidates`, `ProjectAuditLog*Response`, `getProjectAuditLogs`, `addProjectMember`, `updateProjectMemberRole`, `removeProjectMember`, `getDashboardData`, `getIssueDetail`
  - `storage.ts`에서 사라지는 것: `readPreviewLabels`, `writePreviewLabels`
  - 로그인 뒤 첫 화면(`DashboardPage`)은 제목이 "세션"이고, 헤더 버튼(프로젝트 선택, 새 프로젝트, 프로젝트 설정, 페이지 통계, 설치 안내, 로그아웃)과 세션 목록만 있다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin/src/App.test.tsx`의 `describe("App auth state"...)` 안 `it("renders dashboard after auth/me succeeds", ...)`를 다음으로 바꾼다. 이 파일의 fetch 목 헬퍼(파일 위쪽, 200행 이전)를 쓰고, `/auth/me` 목 응답의 `projects`를 `[{ projectId: "proj_1" }]`로 둔다.

```ts
it("로그인하면 세션 화면을 열고 문제 요약은 부르지 않는다", async () => {
  const fetchMock = mockAdminApi({
    "/auth/me": { user: { adminUserId: "adm_1", email: "admin@example.com" }, projects: [{ projectId: "proj_1" }], csrfToken: "csrf", auth: { googleLogin: true, localLogin: false } },
    "/admin/api/projects/proj_1/sessions": { sessions: [] },
  });

  render(<App />);

  expect(await screen.findByRole("heading", { level: 1, name: "세션" })).toBeInTheDocument();
  const calledPaths = fetchMock.mock.calls.map(([url]) => new URL(String(url), "http://localhost").pathname);
  expect(calledPaths.some((path) => path.endsWith("/summary") || path.endsWith("/issues"))).toBe(false);
});
```

`mockAdminApi`가 이 파일에서 다른 이름(예: `mockFetch`, `routeFetch`)이면 그 이름과 모양을 쓴다. `/sessions` 응답의 실제 모양은 `api.ts`의 `getSessions`가 읽는 모양에 맞춘다.

`apps/admin/src/pages/ProjectSettingsPage.test.tsx`에 추가한다.

```ts
it("멤버 관리 영역을 보여주지 않는다", () => {
  render(<ProjectSettingsPage {...baseProps} />);
  expect(screen.queryByText(/멤버/)).not.toBeInTheDocument();
  expect(screen.queryByText(/활동 이력/)).not.toBeInTheDocument();
});
```

(`baseProps`는 이 파일의 기존 기본 props 이름을 쓴다. 없으면 기존 첫 테스트가 넘기는 props를 `baseProps` 상수로 뽑는다.)

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run apps/admin/src/App.test.tsx apps/admin/src/pages/ProjectSettingsPage.test.tsx
```

Expected: 새 테스트 둘이 FAIL(제목이 "문제 인박스", `/summary`를 부름, 멤버 영역이 보임).

- [ ] **Step 3: 파일을 지운다**

```bash
cd apps/admin/src
git rm -q components/IssueDashboardOverview.tsx components/IssueDashboardOverview.test.tsx \
  components/IssueTable.tsx components/IssueTable.test.tsx components/MetricStrip.tsx \
  components/ScreenContextPreview.tsx components/ScreenContextPreview.test.tsx \
  components/charts/FrictionTrendChart.tsx components/charts/IssueTypeChart.tsx components/charts/IssueTypeChart.test.tsx \
  pages/IssueDetailPage.tsx pages/IssueDetailPage.test.tsx \
  pages/ProjectAuditLogPage.tsx pages/ProjectAuditLogPage.test.tsx
cd -
```

차트 라이브러리를 이 차트들만 썼다면 `apps/admin/package.json`의 의존성에서 지운다. 확인: `grep -rn "from \"recharts\"\|from 'recharts'" apps/admin/src`(또는 `package.json`에 있는 차트 패키지 이름). 쓰는 곳이 없으면 `npm uninstall <패키지> --workspace @trace/admin`.

- [ ] **Step 4: `api.ts`와 `storage.ts`를 줄인다**

- `api.ts`: Interfaces의 "사라지는 것"을 지운다. `ProjectSettingsResponse`에서 `role`을 지운다. `AuthMeResponse.projects`를 `Array<{ projectId: string }>`로 바꾼다. `DashboardSummary`, `Issue` import를 지운다.
- `storage.ts`: `readPreviewLabels`, `writePreviewLabels`와 그 키 상수를 지운다. `storage.test.ts`에서 두 함수 테스트를 지운다.

- [ ] **Step 5: 화면 컴포넌트를 줄인다**

- `components/SessionTimeline.tsx`: `ScreenContextPreview` import와 `{event.screenContext ? (...) : null}` 블록을 지운다. `SessionTimeline.test.tsx`에서 미리보기를 단언하는 테스트를 지운다.
- `pages/DashboardPage.tsx`를 다음 모양으로 바꾼다. `ProjectOption`은 `{ projectId: string }`로 줄인다.

```tsx
import type { SessionResponse } from "../api.js";
import { SessionTable } from "../components/SessionTable.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

export type ProjectOption = {
  projectId: string;
};

export function DashboardPage({
  userEmail,
  projects = [],
  projectId = "",
  onSelectProject = () => {},
  settingsError,
  onLogout,
  onCreateProject,
  onShowInstall,
  onShowSettings,
  onShowPageStats = () => {},
  sessions = [],
  onSelectSession = () => {},
  onReplaySession = () => {},
}: {
  userEmail: string;
  projects: ProjectOption[];
  projectId: string;
  onSelectProject: (projectId: string) => void;
  settingsError?: string | undefined;
  onLogout: () => void;
  onCreateProject: () => void;
  onShowInstall: () => void;
  onShowSettings: () => void;
  onShowPageStats?: () => void;
  sessions?: SessionResponse[];
  onSelectSession?: (sessionId: string) => void;
  onReplaySession?: (sessionId: string) => void;
}) {
  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>세션</h1>
        </div>
        <div className="header-actions">
          <label className="project-switcher">
            <span>프로젝트</span>
            <select value={projectId} onChange={(event) => onSelectProject(event.currentTarget.value)}>
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectId}
                </option>
              ))}
            </select>
          </label>
          <span className="user-email">{userEmail}</span>
          <Button onClick={onCreateProject}>새 프로젝트</Button>
          <Button onClick={onShowSettings}>프로젝트 설정</Button>
          <Button onClick={onShowPageStats}>페이지 통계</Button>
          <Button onClick={onShowInstall}>설치 안내</Button>
          <Button onClick={onLogout}>로그아웃</Button>
        </div>
      </header>
      {settingsError ? (
        <p className="dashboard-notice" role="alert">
          {settingsError}
        </p>
      ) : null}
      <Card as="section" className="sessions-panel">
        <SessionTable sessions={sessions} onSelectSession={onSelectSession} onReplaySession={onReplaySession} />
      </Card>
    </main>
  );
}
```

`DashboardPage.test.tsx`에서 문제·지표·차트·미리보기를 단언하는 테스트를 지우고, 남는 테스트의 props에서 `summary`, `issues`, `onSelectIssue`, `showPreviewLabels`, `onTogglePreviewLabels`를 지운다.
- `pages/ProjectSettingsPage.tsx`: props에서 `role`, `members`, `onAddMember`, `memberCandidates`, `memberCandidateSearchLoading`, `memberCandidateSearchError`, `selectedMemberCandidate`, `onSearchMemberCandidates`, `onSelectMemberCandidate`, `memberActionsInFlight`, `memberActionError`, `memberActionSavedMessage`, `onUpdateMemberRole`, `onRemoveMember`, `addingMember`, `memberError`, `memberSavedMessage`, 그리고 활동 이력으로 가는 콜백(`onShowAudit` 류)을 지운다. 멤버 섹션과 활동 이력 버튼 JSX를 지운다. `role === "viewer"`로 읽기 전용을 만들던 분기를 지운다(누구나 고친다). `ProjectSettingsPage.test.tsx`에서 멤버·후보·역할·viewer·활동 이력 테스트를 지운다.

- [ ] **Step 6: `App.tsx`를 줄인다**

- `AppState`의 모든 변형에서 `data: { summary: DashboardSummary; issues: Issue[] }`와 `dashboardData: ...` 필드를 지운다. 세션 목록을 상태에 들고 있는 필드가 이미 있으면 그대로 두고, 대시보드 데이터와 함께 불러오던 곳은 `getSessions`만 부르게 한다.
- `"settings"` 변형에서 `currentAdminUserId`, `memberActionRequestIds`, `members`, `memberCandidates`, `memberCandidateSearchRequestId`, `memberCandidateSearchLoading`, `memberCandidateSearchError`, `selectedMemberCandidate`, `addingMember`, `memberError`, `memberSavedMessage`, `memberActionsInFlight`, `memberActionError`, `memberActionSavedMessage`를 지운다.
- `"audit"` 변형 전체를 지운다.
- 지울 함수와 상수: `PROJECT_MEMBER_ERROR_MESSAGES`, `describeProjectMemberError`, `MEMBER_CANDIDATE_SEARCH_ERROR_MESSAGES`, `describeMemberCandidateSearchError`, 감사 로그 오류 지도와 `describeProjectAuditLogError`, `memberRoleUpdateErrorMessage`, `memberRemoveErrorMessage`, `handleTogglePreviewLabels`와 미리보기 상태, 문제 상세를 여닫는 상태·핸들러, 멤버 추가·역할 변경·삭제·후보 검색 핸들러, 활동 이력 진입·더 보기 핸들러와 관련 `useEffect`.
- `PROJECT_SETTINGS_ERROR_MESSAGES`에서 `project_access_denied`, `project_role_forbidden`을 지운다.
- `handleShowSettings`는 `getProjectSettings`만 부르고 멤버·후보를 함께 불러오지 않는다.
- 주기 갱신(`useEffect`에서 현재 프로젝트 데이터를 다시 부르는 곳)은 세션 목록만 다시 부른다.
- `lazy` import 중 `IssueDetailPage`, `ProjectAuditLogPage` 관련 줄을 지운다.
- import에서 `DashboardSummary`, `Issue`, 지운 `api.ts` 함수·타입, `readPreviewLabels`·`writePreviewLabels`를 지운다.

타입 검사가 남은 참조를 모두 알려 준다. `npm run typecheck`가 통과할 때까지 반복한다.

- [ ] **Step 7: 옛 테스트를 정리한다**

`App.test.tsx`에서:
- `describe("App 미리보기 글자 보기", ...)` 전체를 지운다.
- `describe("App 프로젝트 설정", ...)` 안에서 이름에 member·멤버·candidate·후보·role·역할·viewer·활동 이력이 들어간 `it`을 지운다. 남기는 것: "대시보드에서 프로젝트 설정 화면으로 이동한다", "설정 조회에서 프로젝트를 찾지 못하면 대시보드로 돌아갈 수 있다", "프로젝트 설정을 저장하고 성공 메시지를 보여준다", "프로젝트 설정 저장 실패를 한국어 안내로 표시한다", "설정 저장이 401을 받으면 로그인 화면으로 전환한다", "이전 프로젝트의 지연된 설정 조회가 전환한 프로젝트의 대시보드를 덮어쓰지 않는다", "로그아웃 뒤 지연된 설정 조회 응답이 화면을 덮어쓰지 않는다", "설정 조회가 403이면 대시보드에 남아 인라인 안내를 보여준다", "재시도하면 이전 안내가 사라진다". 이 중 멤버 목 응답을 준비하던 부분은 지운다. "설정 조회가 403이면…"은 서버가 더는 403을 내지 않으므로 지운다. "재시도하면 이전 안내가 사라진다"가 그 403에 기대면 함께 지운다.
- `describe("App 프로젝트 전환 동작", ...)`의 "프로젝트를 바꾸면 열려 있던 issue 상세를 닫는다"와 "프로젝트 전환이 403을 받으면 접근 권한 없음 화면으로 전환한다"를 지운다.
- 파일 전체에서 `/auth/me` 목 응답의 `projects` 항목에 붙은 `role`을 지우고, `/summary`·`/issues` 목 경로를 지운다.
- `App.loading.test.tsx`도 같은 기준으로 고친다.

- [ ] **Step 8: CSS를 정리한다**

`pages/pages.css`에서 지운 컴포넌트만 쓰던 규칙을 지운다. 먼저 남은 코드가 쓰는 클래스 이름을 모은다.

```bash
comm -13 \
  <(grep -rhoE 'className=("[^"]+"|\{`[^`]+`\})' apps/admin/src | grep -oE '[a-z][a-z0-9-]+' | sort -u) \
  <(grep -oE '^\.[a-z][a-z0-9-]+' apps/admin/src/pages/pages.css | tr -d . | sort -u)
```

출력된 클래스 중 `issue`, `metric`, `insight`, `chart`, `preview`, `screen-context`, `member`, `audit`, `drawer`로 시작하거나 그 말을 담은 것의 규칙 블록을 지운다. 동적으로 만든 클래스 이름(템플릿 문자열)이 있을 수 있으니, 이름이 애매한 것은 남긴다.

- [ ] **Step 9: 통과를 확인한다**

```bash
npx vitest run apps/admin
npm run typecheck
grep -rn "Issue\b\|issues\|DashboardSummary\|ScreenContext\|PreviewLabels\|Member\|AuditLog\|role" apps/admin/src | grep -v "role=\"\|getByRole\|findByRole\|queryByRole\|getAllByRole\|\.role\b.*aria"
```

Expected: PASS, 타입 오류 없음. grep은 ARIA `role` 속성과 테스트의 `*ByRole` 말고는 나오지 않는다.

- [ ] **Step 10: 커밋한다**

```bash
git add -A apps/admin package.json package-lock.json
git commit -q -m "관리자: 문제·미리보기·멤버·감사 로그 화면을 걷어낸다

로그인 뒤 첫 화면은 세션 목록이다. 누구나 프로젝트 설정을 고친다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 공유 계약을 줄인다

**Files:**
- Delete: `packages/shared/src/issue-labels.ts`, `issue-labels.test.ts`
- Modify: `packages/shared/src/events.ts`, `privacy.ts`, `index.ts`
- Modify: `apps/api/src/routes/ingestion.ts`(`KEPT_EVENT_TYPES`를 계약에서 가져오기)
- Test: `packages/shared/src/events.test.ts`, `privacy.test.ts`

**Interfaces:**
- Consumes: 태스크 2~7 이후 이 타입들을 쓰는 곳이 없다
- Produces:
  - `eventTypeSchema = z.enum(["page_view", "page_leave", "click", "scroll"])`
  - `traceEventSchema`에서 `errorName`, `errorSource`, `errorLine`, `screenContext`가 없다
  - `metadata`는 `{ metric?: "scroll_depth"; score?: number(0~100) }`만 받는다(`strict`)
  - 사라지는 export: `screenRectSchema`, `MAX_SCREEN_LAYOUT_HINTS`, `screenContextSchema`, `ScreenContext`, `issueStatusSchema`, `issueTypeSchema`, `issueSchema`, `dashboardSummarySchema`, `Issue`, `DashboardSummary`, `issueTypeLabel`, `redactMetadata`, `SafeMetadata`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/events.test.ts`에 추가한다.

```ts
it("남긴 네 종류만 이벤트 종류로 받는다", () => {
  expect(eventTypeSchema.options).toEqual(["page_view", "page_leave", "click", "scroll"]);
});

it("스크롤 도달 metadata 만 받는다", () => {
  const base = {
    eventId: "evt_1", sessionId: "sess_1", pageId: "page_1",
    timestamp: "2026-09-30T00:00:00.000Z", type: "scroll", urlPath: "/quote",
  };
  expect(traceEventSchema.safeParse({ ...base, metadata: { metric: "scroll_depth", score: 50 } }).success).toBe(true);
  expect(traceEventSchema.safeParse({ ...base, metadata: { eventName: "report_export" } }).success).toBe(false);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run build --workspace @trace/shared && npx vitest run packages/shared/src/events.test.ts
```

Expected: 새 테스트 둘이 FAIL.

- [ ] **Step 3: 계약을 줄인다**

`events.ts`:
- `eventTypeSchema`를 네 값으로 줄인다.
- `safeMetadataSchema`를 다음으로 바꾸고, 더 쓰지 않는 `sensitiveAnalyticsIdentifierSegments`, `hasSensitiveAnalyticsIdentifierSegments`, `analyticsIdentifierSchema`를 지운다.

```ts
// 남은 metadata 는 스크롤 도달 하나뿐이다(collectors.ts). strict 라 새 키는 거절된다 —
// SDK 가 새 키를 보내려면 여기부터 넓혀야 한다.
const safeMetadataSchema = z.object({
  metric: z.literal("scroll_depth").optional(),
  score: z.number().finite().min(0).max(100).optional(),
}).strict().default({});
```

- `safeScreenTextSchema`, `tagNameSchema`, `errorNameSchema`, `errorSourceSchema`와 그 주석, `screenRectSchema`, `screenElementSchema`, `screenLayoutHintSchema`, `MAX_SCREEN_LAYOUT_HINTS`, `screenContextSchema`, `ScreenContext`를 지운다.
- `traceEventSchema`에서 `errorName`, `errorSource`, `errorLine`, `screenContext`를 지운다.
- `issueStatusSchema`, `issueTypeSchema`, `issueSchema`, `dashboardSummarySchema`, `Issue`, `DashboardSummary`를 지운다.
- 더 쓰지 않는 import(`redactText`, `isSafeElementRole` 등)를 지운다(타입 검사가 알려 준다).

`privacy.ts`: `redactMetadata`, `SafeMetadata`, 그리고 `redactMetadata`만 쓰던 `SAFE_SOURCE_VALUES`, `SAFE_STATUS_VALUES`, `SAFE_METHOD_VALUES`, `ANALYTICS_METADATA_KEYS`, `SENSITIVE_ANALYTICS_IDENTIFIER_SEGMENTS`, `isSafeAnalyticsIdentifier`, `hasSensitiveAnalyticsIdentifierSegments`, `isSafeDuration`을 지운다. 지우기 전에 `grep -n "<이름>" packages/shared/src/privacy.ts`로 다른 함수가 쓰지 않는지 확인한다.

`index.ts`: `export * from "./issue-labels.js";` 줄을 지운다. `git rm packages/shared/src/issue-labels.ts packages/shared/src/issue-labels.test.ts`

`apps/api/src/routes/ingestion.ts`: `KEPT_EVENT_TYPES`를 `new Set<string>(eventTypeSchema.options)`로 바꾸고 주석을 `// 계약이 받는 종류가 아니면 배치를 떨어뜨리지 않고 버린다 — 수집 API 는 거절이 아니라 정리한다.`로 바꾼다. `eventTypeSchema` import를 되살린다.

- [ ] **Step 4: 옛 테스트를 정리한다**

- `events.test.ts`: 지운 스키마(`screenContextSchema`, `issueSchema`, `dashboardSummarySchema`, `errorName`·`errorSource` 검증, 지운 이벤트 종류, 지운 metadata 키)를 보는 테스트를 지운다.
- `privacy.test.ts`: `redactMetadata` 테스트를 지운다.

- [ ] **Step 5: 통과를 확인한다**

```bash
npm run build --workspace @trace/shared
npm run typecheck
npm test 2>&1 | tail -5
grep -rn "screenContext\|ScreenContext\|issueSchema\|DashboardSummary\|issueTypeLabel\|redactMetadata\|errorName\|errorSource\|errorLine\|custom_event\|js_error" packages apps --include=*.ts --include=*.tsx | grep -v node_modules | grep -v dist
```

Expected: 타입 오류 없음, 전체 테스트 PASS. grep은 태스크 2·4에서 쓴 "보내도 버린다/없다" 테스트만 나온다.

- [ ] **Step 6: 커밋한다**

```bash
git add -A packages apps/api
git commit -q -m "계약: 이벤트를 네 종류로 줄이고 문제·화면 맥락 계약을 지운다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: README를 고치고 전체를 확인한다

**Files:**
- Modify: `README.md`
- Test: `packages/sdk/src/replay/index.integration.test.ts`의 README 표 확인 테스트(463행 근처)가 여전히 통과해야 한다

- [ ] **Step 1: README에서 없어진 기능을 걷어낸다**

```bash
grep -n "문제\|이슈\|막히\|막힘\|track\|멤버\|역할\|감사\|활동 이력\|와이어프레임\|미리보기\|오류\|viewer\|owner" README.md
```

나온 줄마다 고친다.
- 맨 위 소개: "사이트에 스크립트 한 줄을 붙이면 사용자가 막히는 지점을…"을 "사이트에 스크립트 한 줄을 붙이면 사용자가 어떤 기능을 쓰고 어떤 경로로 화면을 오가는지 관리자 페이지에서 보고, 세션을 리플레이로 다시 볼 수 있습니다."로 바꾼다.
- "수집하는 것과 수집하지 않는 것" 표: `track()` metadata 문단(148행 근처)을 지운다. JS 오류 관련 행이 있으면 지운다. 요소 텍스트 행의 "클릭한 요소와 그 주변 상자의 글자를" 표현을 "클릭한 요소의 글자를"로 바꾼다(주변 상자는 더 모으지 않는다).
- 세션 리플레이 절: "문제가 생긴 세션만" 류 설명이 있으면 "리플레이를 켠 프로젝트는 모든 세션을 녹화합니다"로 바꾼다.
- 멤버·역할·감사 로그 설명이 있으면 "`ADMIN_ALLOWED_EMAILS`에 있는 사람은 모든 프로젝트를 보고 고칠 수 있습니다"로 바꾼다.
- "스펙과 계획" 절은 태스크 1에서 바꾼 한 줄에 이 계획 경로 한 줄을 더한다.

"쿠키·localStorage를 쓰지 않는다" 문구는 ② 단계에서 바꾼다(아직 동작이 그대로다). 건드리지 않는다.

- [ ] **Step 2: 전체를 확인한다**

```bash
npm run build
npm run typecheck
npm test 2>&1 | tail -5
```

Expected: 빌드 성공, 타입 오류 없음, 전체 테스트 PASS. `packages/sdk/src/bundle-size.test.ts`(gzip 10KB 예산)도 PASS다.

- [ ] **Step 3: 데모에서 직접 확인한다**

로컬 DB를 새로 만들어야 한다. 워크트리의 `apps/api/.env`와 루트 `.env`를 메인 저장소에서 복사한다(없으면 `.env.example`로 만든다). `TRACE_DB_PATH`를 워크트리 안의 새 파일로 둔다.

```bash
cp /Users/choimiae/workspace/trace/.env .env 2>/dev/null || cp .env.example .env
cp /Users/choimiae/workspace/trace/apps/api/.env apps/api/.env 2>/dev/null || cp apps/api/.env.example apps/api/.env
lsof -iTCP -sTCP:LISTEN -P | grep -E ':(3000|4000|5173)\b'
```

포트 3000·4000·5173을 다른 프로세스(메인 저장소의 개발 서버)가 쓰고 있으면 멈추고 사용자에게 알린다. 그 서버는 옛 번들을 내려준다. 사용자가 끄면 진행한다.

```bash
TRACE_DB_PATH=./trace.stage1.db npm run dev:api     # 백그라운드
npm run dev:admin                                    # 백그라운드
npm run dev:demo                                     # 백그라운드
```

브라우저에서 확인한다(스크린샷을 남긴다).
1. `http://localhost:5173` → 로컬 로그인 → 프로젝트가 없으므로 생성 폼. 이름 `데모`, 허용 도메인 `http://localhost:3000`으로 만든다.
2. 설치 안내에 나온 프로젝트 ID를 데모 사이트가 쓰게 한다(`examples/demo-site/index.html`의 `data-project-id`). 이 변경은 커밋하지 않는다.
3. 프로젝트 설정에서 리플레이를 켠다. 멤버·활동 이력 영역이 없는지 본다.
4. `http://localhost:3000`에서 화면 서너 개를 오가며 버튼을 누른다. 10초 넘게 머문다.
5. 관리자 첫 화면 제목이 "세션"이고 방금 세션이 목록에 있는지, 타임라인을 열면 `page_view`·`click`·`scroll`만 보이고 화면 미리보기가 없는지, 재생 버튼으로 리플레이가 재생되는지 본다.
6. 페이지 통계 화면이 열리는지 본다.

하나라도 안 되면 멈추고 보고한다.

- [ ] **Step 4: 개발 서버를 끄고 데모 변경을 되돌린다**

```bash
git checkout -- examples/demo-site/index.html
rm -f trace.stage1.db trace.stage1.db-wal trace.stage1.db-shm
git status --short
```

Expected: README 변경만 남는다(`.env` 류는 `.gitignore`에 있다).

- [ ] **Step 5: 커밋한다**

```bash
git add README.md
git commit -q -m "문서: README 에서 걷어낸 기능 설명을 지운다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 저장소 밖 정리와 브랜치 마감

git에 들어가지 않는 로컬 파일을 지운다. 되돌릴 수 없다. 사용자가 2026-09-30에 모두 지우기로 승인했다.

**Files:** 없음(메인 저장소의 무시된 파일과 워크트리, 브랜치)

- [ ] **Step 1: 브랜치를 마감한다**

superpowers:finishing-a-development-branch를 따른다. 로컬 `main`으로 fast-forward 머지하고, 푸시는 하지 않는다. `feature/simplify` 워크트리 안에만 있는 무시된 파일(`git -C .worktrees/simplify status --porcelain --ignored | grep -v node_modules | grep -v dist | grep -v tsbuildinfo`)을 확인해 사용자에게 보고한 뒤 워크트리를 지운다.

- [ ] **Step 2: 지울 대상을 다시 확인한다**

메인 저장소에서 실행한다.

```bash
cd /Users/choimiae/workspace/trace
git worktree list
git branch
du -sh .superpowers/* 2>/dev/null
ls -la trace.db apps/api/trace.db* 2>/dev/null
lsof apps/api/trace.db 2>/dev/null
```

`apps/api/trace.db`를 연 프로세스가 있으면(메인 저장소의 `dev:api`) 사용자에게 끄도록 요청하고 기다린다.

- [ ] **Step 3: 지운다**

```bash
git worktree remove --force .worktrees/region-render
git worktree remove --force .worktrees/session-list
rmdir .worktrees/work 2>/dev/null || true
git branch -D feature/region-render feature/session-list feature/demo-site
rm -rf .superpowers
rm -f trace.db apps/api/trace.db apps/api/trace.db-wal apps/api/trace.db-shm
git worktree prune
git worktree list && git branch
```

`.superpowers/brainstorm/`에서 돌던 시각 보조 서버가 아직 살아 있으면 먼저 멈춘다: `/Users/choimiae/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/brainstorming/scripts/stop-server.sh .superpowers/brainstorm/12640-1790767354`.

Expected: 워크트리는 메인 하나, 브랜치는 `main` 하나.

- [ ] **Step 4: 마감 상태를 확인한다**

```bash
npm run build && npm run typecheck && npm test 2>&1 | tail -5
git log --oneline origin/main..main
```

Expected: 모두 통과. `origin/main..main`에 이 단계의 커밋과 설계 커밋, 데모 사이트 커밋이 보인다. 사용자에게 푸시가 필요하다고 알린다.
