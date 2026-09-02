# 화면 맥락 2단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미리보기가 실제 수집 데이터만으로 "어느 화면의 어디를 눌렀는지"를 전달하게 만들고, 오류 기반 막힘에 개발자가 원인 추적을 시작할 최소 식별자를 붙인다.

**Architecture:** SDK 가 클릭 대상 주변 구조(랜드마크 + 이웃 상호작용 요소)를 `layoutHints` 로 수집한다. 계약·서버 sanitize·렌더링은 1단계에서 이미 만들어져 있고 생산자만 없으므로, 이번 작업의 대부분은 SDK 생산자와 서버 정책 집행이다. 오류 식별자는 `window.onerror` 에서 종류·스크립트 경로·라인만 뽑아 타입 계약으로 저장하고, 탐지기가 Issue 서명으로 승격한다. 관리자 첫 화면은 근거 패널을 목업의 항목별 표로 바꾼다.

**Tech Stack:** TypeScript, Zod, Vitest, React Testing Library, Fastify, better-sqlite3, SQLite

**Spec:** `docs/superpowers/specs/2026-09-02-screen-context-stage2-design.md`

## Global Constraints

- 오류 메시지 본문(`event.message`)과 스택(`error.stack`)은 수집하지 않는다.
- 페이지 제목(`document.title`)은 수집하지 않는다. 1단계에서 중단한 결정을 유지한다.
- 입력 계열 요소(`input`/`textarea`/`contenteditable`)와 컨테이너의 텍스트는 저장하지 않는다.
- `masked: true` 인 힌트는 텍스트를 담지 않는다. SDK 와 서버 양쪽에서 집행한다.
- 화면 위에는 복잡한 말풍선을 올리지 않는다. 클릭 위치 표시만 화면 내부에 두고, 설명은 우측 근거 패널 또는 하단에 둔다.
- 픽셀 스크린샷·canvas 캡처·rrweb 류 리플레이를 도입하지 않는다.
- 수집 실패는 고객 사이트 동작에 영향을 주지 않는다. 수집 경로의 예외는 삼켜서 필드를 생략한다.
- 수집 API 는 거절이 아니라 정리한다. 잘못된 값은 필드만 버리고 배치는 202 로 받는다.
- SDK 번들은 gzip 예산 10KB 안에 있어야 한다 (`packages/sdk/src/bundle-size.test.ts`).
- 관리자 화면 문구는 한국어를 기본으로 한다.
- CSS 는 `apps/admin/src/styles/tokens.css` 의 의미값 토큰만 참조한다. 원시 hex 를 새로 넣지 않는다.
- 상대 임포트는 명시 `.js` 확장자를 쓴다. 공유 타입은 `@trace/shared` 루트에서 가져온다 (`@trace/shared/events` 서브패스는 존재하지 않는다).

---

## File Structure

- Modify: `packages/shared/src/events.ts`
  - `traceEventSchema` 에 `errorName`/`errorSource`/`errorLine`, `issueSchema` 에 `relatedErrorSignature` 추가.
- Modify: `packages/shared/src/events.test.ts`
  - 새 필드의 허용·거절 경계 검증.
- Modify: `packages/sdk/src/dom.ts`
  - `collectLayoutHints` 추가, `getScreenContext` 가 호출.
- Modify: `packages/sdk/src/dom.test.ts`
  - 힌트 선별·텍스트 정책·생산자↔소비자 왕복 검증.
- Modify: `packages/sdk/src/collectors.ts`
  - `error` 리스너가 오류 종류·스크립트 경로·라인을 싣는다.
- Modify: `packages/sdk/src/client.test.ts`
  - 오류 이벤트 페이로드 검증.
- Modify: `apps/api/src/routes/ingestion.ts`
  - `masked` 힌트 텍스트 삭제, 오류 필드 느슨한 수신 + sanitize.
- Modify: `apps/api/src/routes/ingestion.test.ts`
  - 서버 정책 집행과 오류 필드 정리 검증.
- Modify: `apps/api/src/db/schema.sqlite.ts`
  - `events` 에 `error_name`/`error_source`/`error_line`, `issues` 에 `related_error_signature` 컬럼.
- Modify: `apps/api/src/store/sqlite-store.ts`
  - 컬럼 저장·하이드레이션·마이그레이션·디버그 뷰.
- Modify: `apps/api/src/store/store-contract.test.ts`
  - 두 스토어의 오류 필드·Issue 서명 왕복 검증.
- Modify: `apps/api/src/detection/detect.ts`
  - `detectErrorFriction` 이 `relatedErrorSignature` 를 조립.
- Modify: `apps/api/src/detection/detect.test.ts`
  - 서명 조립과 부분 정보 처리 검증.
- Modify: `apps/admin/src/components/IssueDashboardOverview.tsx`
  - 근거 5행 표, hero 점수 필, 이벤트 캡션.
- Modify: `apps/admin/src/components/IssueDashboardOverview.test.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.test.tsx`
- Modify: `apps/admin/src/pages/pages.css`
  - 근거 표·점수 필·캡션 스타일, `.priority-issue` 그리드 재구성.

---

## Task 1: 공유 계약에 오류 필드 추가

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/events.test.ts`

**Interfaces:**
- Consumes: 기존 `traceEventSchema`, `issueSchema`
- Produces:
  - `TraceEvent.errorName?: string`, `TraceEvent.errorSource?: string`, `TraceEvent.errorLine?: number`
  - `Issue.relatedErrorSignature?: string`

- [ ] **Step 1: 실패하는 계약 테스트 작성**

`packages/shared/src/events.test.ts` 에 추가한다. 파일 상단의 기존 임포트(`traceEventSchema`, `issueSchema`)를 그대로 쓴다.

```ts
describe("오류 식별자 계약", () => {
  const baseEvent = {
    eventId: "evt_abcdefghij",
    sessionId: "sess_abcdefghij",
    pageId: "page_abcdefghij",
    timestamp: "2026-09-02T01:00:00.000Z",
    type: "js_error" as const,
    urlPath: "/checkout",
    metadata: {},
  };

  it("안전한 오류 종류·경로·라인을 허용한다", () => {
    const parsed = traceEventSchema.parse({
      ...baseEvent,
      errorName: "TypeError",
      errorSource: "/assets/checkout.js",
      errorLine: 412,
    });

    expect(parsed.errorName).toBe("TypeError");
    expect(parsed.errorSource).toBe("/assets/checkout.js");
    expect(parsed.errorLine).toBe(412);
  });

  it("오류 필드가 없어도 통과한다", () => {
    const parsed = traceEventSchema.parse(baseEvent);

    expect(parsed).not.toHaveProperty("errorName");
    expect(parsed).not.toHaveProperty("errorSource");
    expect(parsed).not.toHaveProperty("errorLine");
  });

  it("메시지가 섞인 오류 종류를 거절한다", () => {
    expect(
      traceEventSchema.safeParse({
        ...baseEvent,
        errorName: "TypeError: Cannot read property 'id' of undefined",
      }).success,
    ).toBe(false);
  });

  it("경로가 아닌 스크립트 값과 쿼리가 붙은 값을 거절한다", () => {
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "https://app.example.com/a.js" }).success).toBe(false);
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "/a.js?token=abc" }).success).toBe(false);
  });

  it("0 이하 또는 소수 라인을 거절한다", () => {
    expect(traceEventSchema.safeParse({ ...baseEvent, errorLine: 0 }).success).toBe(false);
    expect(traceEventSchema.safeParse({ ...baseEvent, errorLine: 12.5 }).success).toBe(false);
  });

  it("이슈에 오류 서명을 허용한다", () => {
    const parsed = issueSchema.parse({
      issueId: "issue_1",
      projectId: "proj_1",
      issueType: "error_friction",
      title: "/checkout 화면에서 오류 기반 막힘이 감지되었습니다",
      summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 45,
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:00:00.000Z",
      trend: "flat",
      exampleSessionIds: ["sess_1"],
      status: "new",
      relatedErrorSignature: "TypeError · /assets/checkout.js:412",
    });

    expect(parsed.relatedErrorSignature).toBe("TypeError · /assets/checkout.js:412");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/shared -- src/events.test.ts`

Expected: FAIL — 새 필드가 없어 `errorName` 등이 스트립되고 `toBe("TypeError")` 가 `undefined` 로 떨어진다.

- [ ] **Step 3: 스키마 필드 추가**

`packages/shared/src/events.ts` 에서 `tagNameSchema` 정의 아래에 추가한다.

```ts
const errorNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);

// redactUrl(...).urlPath 결과 형태만 받는다. origin·쿼리·해시가 붙은 값은 거절해서
// 토큰이 실린 filename 이 그대로 저장되는 경로를 계약에서 막는다.
const errorSourceSchema = z
  .string()
  .trim()
  .max(256)
  .regex(/^\/[^\s?#]*$/);
```

`traceEventSchema` 의 `screenContext` 줄 위에 추가한다.

```ts
  errorName: errorNameSchema.optional(),
  errorSource: errorSourceSchema.optional(),
  errorLine: z.number().int().positive().optional(),
```

`issueSchema` 의 `status` 줄 위에 추가한다.

```ts
  relatedErrorSignature: z.string().trim().min(1).max(320).optional(),
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/shared -- src/events.test.ts`

Expected: PASS.

- [ ] **Step 5: 전체 스위트와 타입 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`
Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck`

Expected: 둘 다 PASS. 기준선은 40 files / 521 tests 이며 새 테스트만큼 늘어난다.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared/src/events.ts packages/shared/src/events.test.ts
git commit -m "기능: 오류 식별자와 이슈 오류 서명 계약 추가"
```

---

## Task 2: SDK layout hints 생산자

**Files:**
- Modify: `packages/sdk/src/dom.ts`
- Modify: `packages/sdk/src/dom.test.ts`

**Interfaces:**
- Consumes: 기존 `getElementMetadata`, `isTextEntryElement`, `redactScreenText`, `clampRectValue`, `rectFromDomRect`, `safeRole`, `SAFE_TAG_NAME_PATTERN`, `ScreenContext`
- Produces:
  - `getScreenContext(element)` 가 `layoutHints` 를 최대 12개 채운다
  - 각 힌트는 `{ tagName, role?, textMaskedOrLimited?, rect, masked }` — `selectorHash` 는 넣지 않는다

- [ ] **Step 1: 실패하는 힌트 선별 테스트 작성**

`packages/sdk/src/dom.test.ts` 의 `getScreenContext` describe 안에 추가한다. 기존 `stubRect` 와 `expectValidScreenContext` 헬퍼를 쓴다.

```ts
it("랜드마크와 타겟 이웃을 힌트로 담는다", () => {
  window.innerWidth = 1440;
  window.innerHeight = 900;
  document.body.innerHTML = `
    <header id="top">Acme Billing</header>
    <nav id="menu"><a href="/plans">요금제</a></nav>
    <main id="page">
      <form id="pay">
        <input id="card" name="card" />
        <button id="submit">결제하기</button>
      </form>
    </main>
  `;
  const rects: Record<string, { x: number; y: number; width: number; height: number }> = {
    top: { x: 0, y: 0, width: 1440, height: 56 },
    menu: { x: 0, y: 56, width: 1440, height: 40 },
    page: { x: 240, y: 96, width: 960, height: 640 },
    pay: { x: 300, y: 160, width: 600, height: 400 },
    card: { x: 320, y: 200, width: 400, height: 44 },
    submit: { x: 320, y: 480, width: 120, height: 40 },
  };
  for (const [id, rect] of Object.entries(rects)) {
    stubRect(document.querySelector(`#${id}`)!, rect);
  }

  const context = expectValidScreenContext(document.querySelector("#submit")!);
  const tags = context.layoutHints.map((hint) => hint.tagName);

  expect(tags).toContain("header");
  expect(tags).toContain("nav");
  expect(tags).toContain("main");
  expect(tags).toContain("input");
  // 타겟 자신은 힌트에 들어가지 않는다.
  expect(context.layoutHints.filter((hint) => hint.tagName === "button")).toHaveLength(0);
  expect(context.target?.tagName).toBe("button");
});

it("입력 필드는 마스킹하고 텍스트를 담지 않는다", () => {
  window.innerWidth = 1440;
  window.innerHeight = 900;
  document.body.innerHTML = `
    <main id="page">
      <textarea id="memo" name="address">서울시 성동구 어딘가</textarea>
      <button id="save">저장</button>
    </main>
  `;
  stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
  stubRect(document.querySelector("#memo")!, { x: 100, y: 100, width: 400, height: 120 });
  stubRect(document.querySelector("#save")!, { x: 100, y: 260, width: 96, height: 40 });

  const context = expectValidScreenContext(document.querySelector("#save")!);
  const memo = context.layoutHints.find((hint) => hint.tagName === "textarea");

  expect(memo?.masked).toBe(true);
  expect(memo).not.toHaveProperty("textMaskedOrLimited");
  expect(JSON.stringify(context)).not.toContain("서울시");
});

it("컨테이너에는 텍스트를 담지 않고 버튼·링크·제목에만 담는다", () => {
  window.innerWidth = 1440;
  window.innerHeight = 900;
  document.body.innerHTML = `
    <main id="page">
      <h2 id="head">결제 확인</h2>
      <section id="box">박스 안의 긴 설명 문구</section>
      <a id="help" href="/help">도움말</a>
      <button id="go">결제하기</button>
    </main>
  `;
  stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
  stubRect(document.querySelector("#head")!, { x: 20, y: 20, width: 300, height: 32 });
  stubRect(document.querySelector("#box")!, { x: 20, y: 60, width: 600, height: 200 });
  stubRect(document.querySelector("#help")!, { x: 20, y: 280, width: 80, height: 24 });
  stubRect(document.querySelector("#go")!, { x: 20, y: 320, width: 120, height: 40 });

  const context = expectValidScreenContext(document.querySelector("#go")!);
  const byTag = (tagName: string) => context.layoutHints.find((hint) => hint.tagName === tagName);

  expect(byTag("a")?.textMaskedOrLimited).toBe("도움말");
  expect(byTag("h2")?.textMaskedOrLimited).toBe("결제 확인");
  // main 은 랜드마크로 수집되지만 컨테이너이므로 텍스트가 없다.
  expect(byTag("main")).toBeDefined();
  expect(byTag("main")).not.toHaveProperty("textMaskedOrLimited");
  // section 은 이웃 셀렉터에도 랜드마크에도 없어 아예 수집되지 않는다.
  expect(byTag("section")).toBeUndefined();
  expect(JSON.stringify(context)).not.toContain("박스 안의 긴 설명 문구");
});

it("뷰포트 밖 요소는 힌트에서 제외한다", () => {
  window.innerWidth = 1440;
  window.innerHeight = 900;
  document.body.innerHTML = `
    <main id="page"><button id="far">아래쪽</button><button id="go">저장</button></main>
  `;
  stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
  stubRect(document.querySelector("#far")!, { x: 0, y: 5000, width: 100, height: 40 });
  stubRect(document.querySelector("#go")!, { x: 10, y: 20, width: 96, height: 40 });

  const context = expectValidScreenContext(document.querySelector("#go")!);

  expect(context.layoutHints.some((hint) => hint.textMaskedOrLimited === "아래쪽")).toBe(false);
});

it("후보가 많아도 힌트는 12개를 넘지 않는다", () => {
  window.innerWidth = 1440;
  window.innerHeight = 900;
  const buttons = Array.from({ length: 80 }, (_unused, index) => `<button id="b${index}">버튼${index}</button>`).join("");
  document.body.innerHTML = `<main id="page">${buttons}<button id="go">저장</button></main>`;
  stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
  for (let index = 0; index < 80; index += 1) {
    stubRect(document.querySelector(`#b${index}`)!, { x: index, y: index, width: 40, height: 20 });
  }
  stubRect(document.querySelector("#go")!, { x: 10, y: 10, width: 96, height: 40 });

  const context = expectValidScreenContext(document.querySelector("#go")!);

  expect(context.layoutHints.length).toBeLessThanOrEqual(12);
});

it("랜드마크가 없는 문서에서도 안전하게 동작한다", () => {
  window.innerWidth = 390;
  window.innerHeight = 844;
  document.body.innerHTML = `<div><button id="go">저장</button></div>`;
  stubRect(document.querySelector("#go")!, { x: 10, y: 20, width: 96, height: 40 });

  const context = expectValidScreenContext(document.querySelector("#go")!);

  expect(Array.isArray(context.layoutHints)).toBe(true);
});

it("contenteditable 안의 버튼도 텍스트를 담지 않는다", () => {
  window.innerWidth = 1440;
  window.innerHeight = 900;
  document.body.innerHTML = `
    <main id="page">
      <div id="editor" contenteditable="true"><button id="inner">고객 김철수</button></div>
      <button id="go">저장</button>
    </main>
  `;
  stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
  stubRect(document.querySelector("#editor")!, { x: 20, y: 20, width: 600, height: 200 });
  stubRect(document.querySelector("#inner")!, { x: 40, y: 40, width: 200, height: 40 });
  stubRect(document.querySelector("#go")!, { x: 20, y: 260, width: 96, height: 40 });

  const context = expectValidScreenContext(document.querySelector("#go")!);

  expect(JSON.stringify(context)).not.toContain("김철수");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/sdk -- src/dom.test.ts`

Expected: FAIL — `layoutHints` 가 항상 `[]` 이므로 `toContain("header")` 등이 실패한다.

- [ ] **Step 3: contenteditable 조상까지 보게 만든다**

현재 `isTextEntryElement`(`dom.ts:15-21`)는 요소 **자신**의 `contenteditable` 속성과 `element.isContentEditable` 만 본다. jsdom 은 `isContentEditable` 를 상속하지 않으므로 `<div contenteditable><button>고객 김철수</button></div>` 의 버튼이 걸러지지 않고, 실제 브라우저에서도 `instanceof HTMLElement` 가 아닌 SVG 자손은 빠진다. 힌트는 클릭 대상 주변을 최대 12개까지 걷으므로 이 구멍이 12배로 커진다.

조상을 함께 보도록 바꾼다.

```ts
const CONTENTEDITABLE_SELECTOR = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
// select 의 option 라벨도 textContent 에 들어간다. <a><span>행 열기</span><select>
// <option>김철수</option></select></a> 처럼 사용자 데이터가 실린다.
const TEXT_ENTRY_SUBTREE_SELECTOR = `textarea, select, ${CONTENTEDITABLE_SELECTOR}`;

// 자신과 자손을 모두 본다. querySelector 는 자신을 매칭하지 않으므로, 이걸
// 자손만으로 두면 <select> 를 직접 클릭했을 때 option 라벨이 타겟 경로로 새어나간다.
function containsTextEntrySubtree(element: Element): boolean {
  return element.matches(TEXT_ENTRY_SUBTREE_SELECTOR) || element.querySelector(TEXT_ENTRY_SUBTREE_SELECTOR) !== null;
}

function isTextEntryElement(element: Element): boolean {
  if (element.tagName.toLowerCase() === "textarea") return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  // jsdom 은 isContentEditable 을 상속하지 않고, SVG 자손은 HTMLElement 도 아니다.
  // 편집 영역 안의 텍스트는 어느 자손이 담고 있어도 사용자가 쓴 내용이므로 조상을 본다.
  return element.closest(CONTENTEDITABLE_SELECTOR) !== null;
}
```

이 함수는 `getElementMetadata` 도 쓰므로(1단계 I7 수정) 최상위 `elementTextMaskedOrLimited` 의 억제 범위도 함께 넓어진다. 개인정보 방향으로만 넓어지는 변경이고, 1단계 리뷰가 남긴 미해결 구멍을 닫는다.

- [ ] **Step 4: 상수와 헬퍼 추가**

`packages/sdk/src/dom.ts` 의 기존 상수 블록(`SAFE_TAG_NAME_PATTERN` 아래)에 추가한다.

```ts
const MAX_LAYOUT_HINTS = 12;
const MAX_LANDMARK_HINTS = 4;
const MAX_NEIGHBOR_HINTS = 8;
// 클릭당 검사 후보 상한. 시간 기반 throttle 대신 작업량을 묶는다 — rage click 의
// 2번째 이후 클릭에서 힌트가 사라지면 정작 필요한 이슈에서 화면이 빈다.
const MAX_HINT_CANDIDATES = 60;
const LANDMARK_SELECTOR =
  "header, nav, main, aside, [role=banner], [role=navigation], [role=main], [role=complementary]";
// 제목도 포함한다. h1-h3 는 TEXT_TAG_WHITELIST 에 있는데 랜드마크도 아니어서,
// 이웃 셀렉터에 없으면 수집 자체가 안 돼 화이트리스트가 死코드가 된다.
const NEIGHBOR_SELECTOR =
  "button, a[href], input, select, textarea, h1, h2, h3, [role=button], [role=link], [role=tab], [role=heading]";
const CONTAINER_SELECTOR = "form, section, header, nav, main, aside";
// role 은 getAttribute("role") ?? tagName 이므로 <a> 는 role 이 "a", <h2> 는 "h2" 다.
// role 이름만으로 화이트리스트를 쓰면 대부분 걸리지 않는다.
const TEXT_ROLE_WHITELIST = new Set(["button", "link", "tab", "heading"]);
const TEXT_TAG_WHITELIST = new Set(["button", "a", "h1", "h2", "h3"]);

type ScreenLayoutHint = ScreenContext["layoutHints"][number];
```

같은 파일에 헬퍼를 추가한다.

```ts
// 원시 DOMRect 로 판정한다. rectFromDomRect 가 x/y 를 0 으로 클램프한 뒤에 보면
// 화면 위쪽·왼쪽으로 스크롤된 요소가 y:0 으로 접혀 통과하고, 미리보기 상단에
// 몰려 실제 화면을 왜곡한다.
function intersectsViewport(rect: DOMRect | ClientRect, viewport: ScreenViewport): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.right > 0 && rect.bottom > 0 && rect.left < viewport.width && rect.top < viewport.height;
}

function rectCenterDistance(left: ScreenRect, right: ScreenRect): number {
  const dx = left.x + left.width / 2 - (right.x + right.width / 2);
  const dy = left.y + left.height / 2 - (right.y + right.height / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

function allowsHintText(element: Element, tagName: string, role: string | undefined): boolean {
  if (isTextEntryElement(element)) return false;
  if (role !== undefined && TEXT_ROLE_WHITELIST.has(role)) return true;
  return TEXT_TAG_WHITELIST.has(tagName);
}

// masked 는 "내용을 보여주지 않는다" 는 표시다. isTextEntryElement 는 textarea 와
// contenteditable 만 잡고 <input> 은 잡지 않으므로, 그것만으로 계산하면 password
// 입력조차 masked:false 가 되어 미리보기가 평범한 박스로 그려지고 Task 3 의 서버
// 집행도 무력해진다. spec 표(입력 계열 또는 isSensitiveField)대로 계산한다.
function isMaskedHintElement(element: Element, tagName: string): boolean {
  if (isTextEntryElement(element)) return true;
  if (tagName === "input" || tagName === "select") return true;
  return isSensitiveField({
    tagName: element.tagName,
    type: element instanceof HTMLInputElement ? element.type : "",
    name: element instanceof HTMLInputElement ? element.name : "",
    id: element.id,
  });
}

function buildLayoutHint(
  element: Element,
  viewport: ScreenViewport,
): { hint: ScreenLayoutHint; rect: ScreenRect } | undefined {
  const tagName = element.tagName.toLowerCase();
  if (!SAFE_TAG_NAME_PATTERN.test(tagName)) return undefined;

  const domRect = element.getBoundingClientRect();
  if (!intersectsViewport(domRect, viewport)) return undefined;
  const rect = rectFromDomRect(domRect);

  const metadata = getElementMetadata(element);
  const role = safeRole(metadata.elementRole);
  const masked = isMaskedHintElement(element, tagName);
  const text =
    allowsHintText(element, tagName, role) && metadata.elementTextMaskedOrLimited
      ? redactScreenText(metadata.elementTextMaskedOrLimited)
      : undefined;

  return {
    rect,
    hint: {
      tagName,
      ...(role ? { role } : {}),
      ...(text && text.length > 0 ? { textMaskedOrLimited: text } : {}),
      rect,
      masked,
    },
  };
}
```

`masked` 는 입력 계열일 때만 `true` 다. `allowsHintText` 가 이미 `isTextEntryElement` 를 먼저 걸러내므로 텍스트 조건에서 중복 검사하지 않는다.

- [ ] **Step 5: 수집 함수 추가**

같은 파일에 추가한다.

```ts
function nearestContainer(target: Element): Element {
  let current: Element | null = target.parentElement;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (current.matches(CONTAINER_SELECTOR)) return current;
    current = current.parentElement;
  }
  // body 가 없는 문서(XML 등)도 있다. 그 경우 documentElement 로, 그마저 없으면
  // 타겟 자신으로 떨어뜨려 querySelectorAll 이 null 에서 터지지 않게 한다.
  return target.ownerDocument.body ?? target.ownerDocument.documentElement ?? target;
}

function collectLayoutHints(target: Element, viewport: ScreenViewport): ScreenLayoutHint[] {
  const targetRect = rectFromDomRect(target.getBoundingClientRect());
  const seen = new Set<string>();
  const hints: ScreenLayoutHint[] = [];

  // 힌트 하나가 던져도 화면 맥락 전체를 잃지 않는다. getScreenContext 의 바깥
  // try/catch 에 맡기면 타겟과 뷰포트까지 날아가서 힌트를 안 걷는 것보다 나쁘다.
  const push = (element: Element): void => {
    if (element === target || hints.length >= MAX_LAYOUT_HINTS) return;
    let built: ReturnType<typeof buildLayoutHint>;
    try {
      built = buildLayoutHint(element, viewport);
    } catch {
      return;
    }
    if (!built) return;
    const key = `${built.rect.x}:${built.rect.y}:${built.rect.width}:${built.rect.height}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(built.hint);
  };

  const landmarks = Array.from(target.ownerDocument.querySelectorAll(LANDMARK_SELECTOR)).slice(
    0,
    MAX_HINT_CANDIDATES,
  );
  for (const landmark of landmarks) {
    if (hints.length >= MAX_LANDMARK_HINTS) break;
    push(landmark);
  }

  // 후보를 문서 순서로 자르면 안 된다. nearestContainer 가 body 로 폴백한 경우
  // 문서 앞쪽의 페이지 크롬이 60칸을 다 먹고 정작 타겟 이웃은 후보에도 못 든다.
  // 타겟의 문서 순서 위치를 중심으로 창을 잡아 rect 읽기를 묶은 뒤 거리로 정렬한다.
  const container = nearestContainer(target);
  const all = Array.from(container.querySelectorAll(NEIGHBOR_SELECTOR));
  // 클릭은 버튼 안의 아이콘·span, 테이블 셀, 평범한 div 에 자주 떨어진다. 그런
  // 요소는 all 에 없어서 indexOf 가 -1 이고, anchor 를 0 으로 떨어뜨리면 창이
  // 문서 앞쪽으로 붕괴해 페이지 크롬이 12칸을 다 먹는다. 가장 가까운 후보를
  // 기준으로 삼는다. 타겟 자체는 바꾸지 않는다 — 클릭 마커는 실제 클릭 요소를 쓴다.
  // 신원(indexOf)이 아니라 문서 위치로 기준점을 잡는다. closest 로 상호작용 조상을
  // 찾아도 그 조상이 nearestContainer 밖에 있으면 all 에 없어서 다시 -1 이 되고,
  // 상호작용 조상이 아예 없는 클릭(맨 div)도 -1 이다. 두 경우 모두 anchor 가 0 으로
  // 붕괴해 창이 문서 앞쪽으로 쏠린다. 타겟 뒤에 오는 첫 후보의 위치를 삽입점으로
  // 쓰면 타겟이 all 에 있든 없든 항상 타겟 주변이 잡힌다.
  let anchor = all.findIndex(
    (candidate) => (target.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  if (anchor === -1) anchor = all.length;
  const half = Math.floor(MAX_HINT_CANDIDATES / 2);
  const windowed = all.slice(Math.max(0, anchor - half), anchor + half);
  // 거리 계산도 rect 를 읽으므로 여기서 가드해야 한다. push 의 try/catch 는 이
  // .map() 뒤에 실행되므로, 던지는 이웃이 하나 있으면 정렬 단계에서 먼저 터진다.
  const ranked: Array<{ element: Element; distance: number }> = [];
  for (const element of windowed) {
    try {
      ranked.push({ element, distance: rectCenterDistance(rectFromDomRect(element.getBoundingClientRect()), targetRect) });
    } catch {
      // 이 후보만 버린다.
    }
  }
  const neighbors = ranked.sort((left, right) => left.distance - right.distance);

  // 랜드마크가 없으면 이웃이 유일한 신호다. 4+8 은 랜드마크 몫을 예약하는 뜻이지
  // 전체 상한을 8로 낮추라는 뜻이 아니므로, 이웃은 12칸까지 채운다.
  for (const neighbor of neighbors) {
    if (hints.length >= MAX_LAYOUT_HINTS) break;
    push(neighbor.element);
  }

  return hints;
}
```

정렬은 거리 오름차순이고 `Array.prototype.sort` 는 안정 정렬이므로 같은 거리면 문서 순서가 유지된다.

- [ ] **Step 6: getScreenContext 에 연결**

`getScreenContext` 의 `layoutHints: []` 를 바꾼다.

```ts
      layoutHints: collectLayoutHints(element, viewport),
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/sdk -- src/dom.test.ts`

Expected: PASS. `expectValidScreenContext` 가 매 케이스에서 `screenContextSchema.safeParse` 를 통과시키므로 생산자↔소비자 왕복이 함께 검증된다.

- [ ] **Step 8: 번들 예산 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/sdk`

Expected: PASS. `bundle-size.test.ts` 가 gzip 10KB 예산을 지킨다. 초과하면 멈추고 보고한다 — 예산을 올리지 않는다.

- [ ] **Step 9: 커밋**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts
git commit -m "기능: 클릭 주변 구조를 layout hints 로 수집"
```

---

## Task 3: 서버가 masked 힌트 텍스트를 삭제

**Files:**
- Modify: `apps/api/src/routes/ingestion.ts`
- Modify: `apps/api/src/routes/ingestion.test.ts`

**Interfaces:**
- Consumes: 기존 `sanitizeScreenContext`, `sanitizeScreenElement`
- Produces: 저장되는 어떤 힌트도 `masked: true` 와 `textMaskedOrLimited` 를 동시에 갖지 않는다

- [ ] **Step 1: 실패하는 서버 집행 테스트 작성**

`apps/api/src/routes/ingestion.test.ts` 에 추가한다. 파일의 기존 패턴(`MemoryStore`, `createApp`, `app.inject`)을 따른다.

```ts
it("masked 힌트가 텍스트를 실어 보내도 서버가 텍스트를 지운다", async () => {
  const store = new MemoryStore();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });
  const app = createApp({ store });

  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { origin: "https://demo.example.com" },
    payload: {
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-02T01:00:02.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/settings",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          metadata: {},
          screenContext: {
            viewport: { width: 1440, height: 900 },
            target: { tagName: "button", rect: { x: 10, y: 10, width: 90, height: 40 } },
            layoutHints: [
              {
                tagName: "textarea",
                masked: true,
                textMaskedOrLimited: "고객 메모 원문",
                rect: { x: 20, y: 60, width: 400, height: 120 },
              },
              {
                tagName: "a",
                masked: false,
                textMaskedOrLimited: "도움말",
                rect: { x: 20, y: 200, width: 80, height: 24 },
              },
            ],
          },
        },
      ],
    },
  });

  expect(response.statusCode).toBe(202);
  const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
  const hints = timeline[0]?.screenContext?.layoutHints ?? [];
  const masked = hints.find((hint) => hint.tagName === "textarea");
  const link = hints.find((hint) => hint.tagName === "a");

  expect(masked?.masked).toBe(true);
  expect(masked).not.toHaveProperty("textMaskedOrLimited");
  expect(link?.textMaskedOrLimited).toBe("도움말");
  expect(JSON.stringify(timeline)).not.toContain("고객 메모 원문");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/ingestion.test.ts`

Expected: FAIL — `masked` 힌트가 `textMaskedOrLimited: "고객 메모 원문"` 을 그대로 갖는다.

- [ ] **Step 3: 삭제 로직 추가**

`apps/api/src/routes/ingestion.ts` 의 `sanitizeScreenContext` 안 `layoutHints` 매핑을 바꾼다.

같은 파일의 상수 블록에 서버 측 분류 집합을 추가한다.

```ts
// 힌트 텍스트는 서버도 독자 화이트리스트로 건다. SDK 화이트리스트가 유일한
// 관문이면 구식·오염 SDK 가 컨테이너 텍스트를 그대로 밀어넣을 수 있다.
// 타겟에는 적용하지 않는다 — 타겟은 클릭된 요소이고 그 라벨을 보여주는 것이 목적이다.
const SERVER_MASKED_TAGS = new Set(["input", "select", "textarea"]);
const SERVER_TEXT_TAGS = new Set(["button", "a", "h1", "h2", "h3"]);
const SERVER_TEXT_ROLES = new Set(["button", "link", "tab", "heading"]);
```


```ts
  const layoutHints = raw.data.layoutHints
    .slice(0, MAX_LAYOUT_HINTS)
    .map((hint) => {
      const sanitized = sanitizeScreenElement(hint);
      if (sanitized === undefined) return undefined;
      // SDK 의 masked 불린만 믿으면 경계가 아니다. 구식 SDK 는 <input> 에
      // masked:false 를 실어 보내고(실제로 그 버그가 있었다), 컨테이너 텍스트도
      // 그대로 올린다. 서버가 태그·role 로 독자 판정한다.
      const masked = hint.masked || SERVER_MASKED_TAGS.has(sanitized.tagName);
      const allowsText =
        !masked &&
        (SERVER_TEXT_TAGS.has(sanitized.tagName) ||
          (sanitized.role !== undefined && SERVER_TEXT_ROLES.has(sanitized.role)));
      if (allowsText) return { ...sanitized, masked };
      const { textMaskedOrLimited: _dropped, ...withoutText } = sanitized;
      return { ...withoutText, masked };
    })
    .filter((hint): hint is NonNullable<typeof hint> => hint !== undefined);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/ingestion.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/routes/ingestion.ts apps/api/src/routes/ingestion.test.ts
git commit -m "수정: masked 힌트 텍스트를 서버에서 삭제"
```

---

## Task 4: SDK 오류 식별자 수집

**Files:**
- Modify: `packages/sdk/src/collectors.ts`
- Modify: `packages/sdk/src/client.test.ts`

**Interfaces:**
- Consumes: 기존 `redactUrl`, Task 1 의 `TraceEvent.errorName`/`errorSource`/`errorLine`
- Produces: `js_error` 이벤트가 오류 종류·스크립트 경로·라인을 싣는다

- [ ] **Step 1: 실패하는 수집 테스트 작성**

`packages/sdk/src/client.test.ts` 에 추가한다.

```ts
it("오류 이벤트에 종류·스크립트 경로·라인을 싣는다", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  const client = new TraceClient({
    projectId: "proj_1",
    endpoint: "https://trace.example.com/v1/events/batch",
    fetcher,
    consent: "granted",
  });

  installCollectors(client);
  window.dispatchEvent(
    new ErrorEvent("error", {
      error: new TypeError("Cannot read property 'id' of undefined"),
      filename: "https://app.example.com/assets/checkout.js?v=2",
      lineno: 412,
      message: "Cannot read property 'id' of undefined",
    }),
  );
  await client.flush();

  const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
  const payload = JSON.parse(String(init.body)) as { events: Array<Record<string, unknown>> };
  const error = payload.events.find((event) => event.type === "js_error");

  expect(error?.errorName).toBe("TypeError");
  expect(error?.errorSource).toBe("/assets/checkout.js");
  expect(error?.errorLine).toBe(412);
  // 메시지와 스택은 어디에도 실리지 않는다.
  expect(JSON.stringify(payload)).not.toContain("Cannot read property");
});

it("cross-origin 오류(error 가 없고 filename 이 빈 값)에서도 이벤트를 보낸다", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  const client = new TraceClient({
    projectId: "proj_1",
    endpoint: "https://trace.example.com/v1/events/batch",
    fetcher,
    consent: "granted",
  });

  installCollectors(client);
  window.dispatchEvent(new ErrorEvent("error", { message: "Script error.", filename: "", lineno: 0 }));
  await client.flush();

  const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
  const payload = JSON.parse(String(init.body)) as { events: Array<Record<string, unknown>> };
  const error = payload.events.find((event) => event.type === "js_error");

  expect(error).toBeDefined();
  expect(error).not.toHaveProperty("errorName");
  expect(error).not.toHaveProperty("errorSource");
  expect(error).not.toHaveProperty("errorLine");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/sdk -- src/client.test.ts`

Expected: FAIL — `errorName` 이 `undefined` 다.

- [ ] **Step 3: 헬퍼 추가**

`packages/sdk/src/collectors.ts` 의 `measuredViewport` 아래에 추가한다.

```ts
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function safeErrorName(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const name = error.name.trim();
  return SAFE_ERROR_NAME_PATTERN.test(name) ? name : undefined;
}

// 선행 "//" 는 통과시킨다. 정상 경로도 그 모양이 될 수 있고(new URL("https://h//a.js")
// .pathname === "//a.js") 수집 API 의 sanitizeErrorSource 가 접는다. 여기서 접으면
// 정규화가 되어 브리핑 제약을 벗어난다.
const SAFE_ERROR_SOURCE_SHAPE = /^\/[^\s?#]*$/;
const MAX_ERROR_SOURCE = 256;

// filename 은 "https://app.example.com/assets/checkout.js?v=2" 같은 전체 URL 이고
// 쿼리에 토큰이 실릴 수 있다. redactUrl 은 new URL 을 쓰므로 빈 값·비 URL 에서
// throw 한다 — cross-origin 오류의 filename 이 "" 이라 가드가 필수다.
//
// 던지지 않는 것만으로는 부족하다. redactUrl 이 성공해도 계약이 거부하는 값이 나온다:
// "data:text/javascript,alert(1)" -> urlPath "text/javascript,alert(1)" (선행 / 없음),
// "about:blank" -> "blank", 그리고 300자 경로는 256 상한을 넘는다. 그대로 보내면
// Task 5 가 필드를 연결한 뒤 배치 전체가 400 이 되고, client 는 4xx 를 영구 실패로
// 보고 같은 flush 의 무관한 이벤트까지 버린다. 모양이 맞지 않으면 필드를 생략한다.
function safeErrorSource(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  try {
    const path = redactUrl(filename).urlPath;
    if (path.length > MAX_ERROR_SOURCE) return undefined;
    return SAFE_ERROR_SOURCE_SHAPE.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function safeErrorLine(lineno: number | undefined): number | undefined {
  if (typeof lineno !== "number" || !Number.isFinite(lineno)) return undefined;
  const rounded = Math.round(lineno);
  return rounded > 0 ? rounded : undefined;
}
```

- [ ] **Step 4: error 리스너 수정**

같은 파일의 `error` 리스너를 바꾼다.

```ts
  window.addEventListener("error", (event) => {
    const errorName = safeErrorName(event.error);
    const errorSource = safeErrorSource(event.filename);
    const errorLine = safeErrorLine(event.lineno);
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "js_error",
        urlPath: currentPath(),
        ...(errorName === undefined ? {} : { errorName }),
        ...(errorSource === undefined ? {} : { errorSource }),
        ...(errorLine === undefined ? {} : { errorLine }),
        metadata: { errorType: "js_error" },
      }),
    );
  });
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/sdk`

Expected: PASS, 번들 예산 포함.

- [ ] **Step 6: 커밋**

```bash
git add packages/sdk/src/collectors.ts packages/sdk/src/client.test.ts
git commit -m "기능: 안전한 오류 식별자 수집 (종류·경로·라인)"
```

---

## Task 5: API 오류 식별자 수신과 저장

**Files:**
- Modify: `apps/api/src/routes/ingestion.ts`
- Modify: `apps/api/src/routes/ingestion.test.ts`
- Modify: `apps/api/src/db/schema.sqlite.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Modify: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 의 계약 필드, Task 4 가 보내는 페이로드
- Produces: `toEvent(row)` 가 `errorName`/`errorSource`/`errorLine` 을 하이드레이션한다

- [ ] **Step 1: 실패하는 스토어 계약 테스트 작성**

`apps/api/src/store/store-contract.test.ts` 에 추가한다. 기존 `open()` 헬퍼를 쓴다.

```ts
it("오류 식별자를 타임라인에서 보존한다", async () => {
  const store = open();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });

  await store.saveBatch({
    projectId: project.projectId,
    anonymousUserId: "anon_1",
    sessionId: "sess_1",
    sentAt: "2026-09-02T01:00:01.000Z",
    sdkVersion: "0.1.0",
    url: "https://demo.example.com/checkout",
    events: [
      {
        eventId: "evt_err",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.000Z",
        type: "js_error",
        urlPath: "/checkout",
        errorName: "TypeError",
        errorSource: "/assets/checkout.js",
        errorLine: 412,
        metadata: {},
      },
      {
        eventId: "evt_plain",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.500Z",
        type: "click",
        urlPath: "/checkout",
        metadata: {},
      },
    ],
  });

  const timeline = await store.getSessionTimeline(project.projectId, "sess_1");

  expect(timeline[0]?.errorName).toBe("TypeError");
  expect(timeline[0]?.errorSource).toBe("/assets/checkout.js");
  expect(timeline[0]?.errorLine).toBe(412);
  expect(timeline[1]).not.toHaveProperty("errorName");
});
```

- [ ] **Step 2: 실패하는 수집 정리 테스트 작성**

`apps/api/src/routes/ingestion.test.ts` 에 추가한다.

```ts
it("잘못된 오류 식별자는 배치를 거절하지 않고 필드만 버린다", async () => {
  const store = new MemoryStore();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });
  const app = createApp({ store });

  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { origin: "https://demo.example.com" },
    payload: {
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-02T01:00:02.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/checkout",
      events: [
        {
          eventId: "evt_bad",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "js_error",
          urlPath: "/checkout",
          errorName: "TypeError: 김철수 저장 실패",
          errorSource: "https://app.example.com/a.js?token=abc",
          errorLine: -3,
          metadata: {},
        },
        {
          eventId: "evt_good",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:01.000Z",
          type: "js_error",
          urlPath: "/checkout",
          errorName: "RangeError",
          errorSource: "/assets/pay.js",
          errorLine: 88,
          metadata: {},
        },
      ],
    },
  });

  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ accepted: 2 });
  const timeline = await store.getSessionTimeline(project.projectId, "sess_1");

  expect(timeline[0]).not.toHaveProperty("errorName");
  expect(timeline[0]).not.toHaveProperty("errorSource");
  expect(timeline[0]).not.toHaveProperty("errorLine");
  expect(timeline[1]?.errorName).toBe("RangeError");
  expect(timeline[1]?.errorSource).toBe("/assets/pay.js");
  expect(JSON.stringify(timeline)).not.toContain("김철수");
  expect(JSON.stringify(timeline)).not.toContain("token=abc");
});

it("선행 이중 슬래시 경로를 버리지 않고 접어서 저장한다", async () => {
  // new URL("https://cdn.example.com//vendor/lib.js").pathname 은 "//vendor/lib.js" 다.
  // 계약이 선행 "//" 를 거절하므로 sanitize 단계에서 접어야 멀쩡한 경로가 살아남는다.
  const store = new MemoryStore();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });
  const app = createApp({ store });

  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { origin: "https://demo.example.com" },
    payload: {
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-02T01:00:02.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/checkout",
      events: [
        {
          eventId: "evt_double",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "js_error",
          urlPath: "/checkout",
          errorName: "TypeError",
          errorSource: "//vendor/lib.js",
          errorLine: 7,
          metadata: {},
        },
      ],
    },
  });

  expect(response.statusCode).toBe(202);
  const timeline = await store.getSessionTimeline(project.projectId, "sess_1");

  expect(timeline[0]?.errorSource).toBe("/vendor/lib.js");
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts src/routes/ingestion.test.ts`

Expected: FAIL — 계약 테스트는 `errorName` 이 `undefined`, 수집 테스트는 잘못된 값에서 배치가 400 이 된다.

- [ ] **Step 4: 수집 스키마와 sanitize 추가**

`apps/api/src/routes/ingestion.ts` 의 `rawTraceEventSchema` 에서 `screenContext` 줄 위에 추가한다. C1 의 교훈대로 느슨하게 받고 정리한다.

```ts
  errorName: z.unknown().optional(),
  errorSource: z.unknown().optional(),
  errorLine: z.unknown().optional(),
```

같은 파일에 헬퍼를 추가한다.

```ts
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SAFE_ERROR_SOURCE_PATTERN = /^\/[^\s?#]*$/;
const MAX_ERROR_SOURCE = 256;

function sanitizeErrorName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return SAFE_ERROR_NAME_PATTERN.test(name) ? name : undefined;
}

// 선행 "//" 를 "/" 로 접는다. new URL("https://h//a.js").pathname 이 "//a.js" 이고
// normalizePath 가 빈 세그먼트를 보존하므로, redactUrl(...).urlPath 는 정상적으로
// 선행 "//" 를 낼 수 있다. 계약은 선행 "//" 를 fail-closed 로 거절하므로(원시
// protocol-relative filename 이 우회로로 들어오는 것을 막는 2차 방어), 여기서 접지
// 않으면 멀쩡한 경로가 조용히 버려진다.
function sanitizeErrorSource(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.trim().replace(/^\/{2,}/, "/");
  if (collapsed.length > MAX_ERROR_SOURCE) return undefined;
  return SAFE_ERROR_SOURCE_PATTERN.test(collapsed) ? collapsed : undefined;
}

function sanitizeErrorLine(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}
```

`sanitizeEvent` 의 `screenContext` 계산 옆에 추가하고 반환 객체에 넣는다.

```ts
  const errorName = sanitizeErrorName(event.errorName);
  const errorSource = sanitizeErrorSource(event.errorSource);
  const errorLine = sanitizeErrorLine(event.errorLine);
```

```ts
    ...(errorName === undefined ? {} : { errorName }),
    ...(errorSource === undefined ? {} : { errorSource }),
    ...(errorLine === undefined ? {} : { errorLine }),
```

- [ ] **Step 5: SQLite 컬럼 추가**

`apps/api/src/db/schema.sqlite.ts` 의 `CREATE TABLE IF NOT EXISTS events` 에서 `screen_context TEXT` 다음에 추가한다.

```sql
  error_name TEXT,
  error_source TEXT,
  error_line INTEGER
```

`apps/api/src/store/sqlite-store.ts` 의 `migrate()` 에 추가한다.

```ts
    for (const column of ["error_name", "error_source"]) {
      if (!hasColumn(this.db, "events", column)) {
        this.db.exec(`ALTER TABLE events ADD COLUMN ${column} TEXT`);
      }
    }
    if (!hasColumn(this.db, "events", "error_line")) {
      this.db.exec("ALTER TABLE events ADD COLUMN error_line INTEGER");
    }
```

- [ ] **Step 6: 저장과 하이드레이션**

`saveBatch` 의 prepared statement 에서 컬럼 목록 끝에 `, error_name, error_source, error_line` 을 추가하고 `?` 를 3개 늘린다. 컬럼 수·플레이스홀더 수·`insert.run` 인자 수가 **모두 22개**로 일치해야 한다 — 어긋나면 조용히 뒤쪽 컬럼이 밀린다.

`insert.run(...)` 인자 끝에 추가한다.

```ts
          event.errorName ?? null,
          event.errorSource ?? null,
          event.errorLine ?? null,
```

`toEvent(row)` 의 반환 객체에 추가한다. `compact` 가 `null` 을 제거하므로 값이 없으면 필드가 빠진다.

```ts
      errorName: row.error_name as string | null,
      errorSource: row.error_source as string | null,
      errorLine: row.error_line as number | null,
```

`createDebugViews()` 의 `events_debug` SELECT 목록에 `error_name, error_source, error_line` 을 추가한다.

- [ ] **Step 7: 테스트 통과 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api`

Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add apps/api/src/routes/ingestion.ts apps/api/src/routes/ingestion.test.ts apps/api/src/db/schema.sqlite.ts apps/api/src/store/sqlite-store.ts apps/api/src/store/store-contract.test.ts
git commit -m "기능: 오류 식별자 수집 정리와 저장"
```

---

## Task 6: 이슈 오류 서명 조립

**Files:**
- Modify: `apps/api/src/detection/detect.ts`
- Modify: `apps/api/src/detection/detect.test.ts`
- Modify: `apps/api/src/db/schema.sqlite.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Modify: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: Task 5 가 저장한 `TraceEvent.errorName`/`errorSource`/`errorLine`, Task 1 의 `Issue.relatedErrorSignature`
- Produces: `error_friction` 이슈가 `relatedErrorSignature` 를 갖는다

- [ ] **Step 1: 실패하는 탐지 테스트 작성**

`apps/api/src/detection/detect.test.ts` 에 추가한다. 파일의 기존 이벤트 픽스처 패턴을 따른다.

```ts
it("오류 이벤트에서 오류 서명을 조립한다", () => {
  const issues = detectIssues({
    projectId: "proj_1",
    now: "2026-09-02T01:00:10.000Z",
    events: [
      {
        eventId: "evt_err",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.000Z",
        type: "js_error",
        urlPath: "/checkout",
        errorName: "TypeError",
        errorSource: "/assets/checkout.js",
        errorLine: 412,
        metadata: {},
      },
    ],
  });
  const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

  expect(errorIssue?.relatedErrorSignature).toBe("TypeError · /assets/checkout.js:412");
});

it("부분 정보만 있으면 있는 값으로만 서명을 만든다", () => {
  const issues = detectIssues({
    projectId: "proj_1",
    now: "2026-09-02T01:00:10.000Z",
    events: [
      {
        eventId: "evt_err",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.000Z",
        type: "js_error",
        urlPath: "/checkout",
        errorName: "RangeError",
        metadata: {},
      },
    ],
  });
  const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

  expect(errorIssue?.relatedErrorSignature).toBe("RangeError");
});

it("오류 식별자가 없으면 서명을 넣지 않는다", () => {
  const issues = detectIssues({
    projectId: "proj_1",
    now: "2026-09-02T01:00:10.000Z",
    events: [
      {
        eventId: "evt_err",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.000Z",
        type: "js_error",
        urlPath: "/checkout",
        metadata: {},
      },
    ],
  });
  const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

  expect(errorIssue).toBeDefined();
  expect(errorIssue).not.toHaveProperty("relatedErrorSignature");
});
```

- [ ] **Step 2: 실패하는 스토어 계약 테스트 작성**

`apps/api/src/store/store-contract.test.ts` 의 이슈 왕복 테스트 옆에 추가한다.

```ts
it("이슈 오류 서명을 보존한다", async () => {
  const store = open();
  const project = await store.createProject({
    name: "Demo",
    allowedDomains: ["https://demo.example.com"],
  });

  await store.upsertIssues(project.projectId, [
    {
      issueId: "issue_err",
      projectId: project.projectId,
      issueType: "error_friction",
      title: "/checkout 화면에서 오류 기반 막힘이 감지되었습니다",
      summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 45,
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:00:00.000Z",
      trend: "flat",
      relatedUrlPath: "/checkout",
      exampleSessionIds: ["sess_1"],
      status: "new",
      relatedErrorSignature: "TypeError · /assets/checkout.js:412",
    },
  ]);

  const issues = await store.listIssues(project.projectId);

  expect(issues[0]?.relatedErrorSignature).toBe("TypeError · /assets/checkout.js:412");
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/detection/detect.test.ts src/store/store-contract.test.ts`

Expected: FAIL — 서명이 `undefined` 다.

- [ ] **Step 4: 서명 조립**

`apps/api/src/detection/detect.ts` 에 헬퍼를 추가한다.

```ts
// 저장은 경로 전체로 한다. basename 으로 줄이면 같은 이름의 다른 경로를 구분할 수 없다.
function errorSignature(event: TraceEvent): string | undefined {
  const location = event.errorSource
    ? `${event.errorSource}${event.errorLine === undefined ? "" : `:${event.errorLine}`}`
    : undefined;
  const parts = [event.errorName, location].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}
```

`detectErrorFriction` 의 `makeIssue({...})` 호출에 추가한다.

```ts
        ...(errorSignature(event) === undefined ? {} : { relatedErrorSignature: errorSignature(event)! }),
```

`makeIssue` 는 `detect.ts:127` 에서 인라인 객체 타입을 받는다(`function makeIssue(input: { ... })`) — 별도 이름의 타입이 아니다. 그 인라인 타입에 `relatedErrorSignature?: string` 을 추가하고, 반환 객체에 `...(input.relatedErrorSignature ? { relatedErrorSignature: input.relatedErrorSignature } : {})` 를 넣는다.

`dedupeIssues` 가 같은 `issueId` 를 병합할 때 기존 서명을 유지하도록, 병합 객체에서 `relatedErrorSignature: existing.relatedErrorSignature ?? issue.relatedErrorSignature` 를 쓴다.

- [ ] **Step 5: 이슈 컬럼 추가**

`apps/api/src/db/schema.sqlite.ts` 의 `CREATE TABLE IF NOT EXISTS issues` 에 `related_error_signature TEXT` 를 추가한다.

`apps/api/src/store/sqlite-store.ts` 의 `migrate()` 에 추가한다.

```ts
    if (!hasColumn(this.db, "issues", "related_error_signature")) {
      this.db.exec("ALTER TABLE issues ADD COLUMN related_error_signature TEXT");
    }
```

`upsertIssues` 의 INSERT 컬럼 목록·플레이스홀더·인자에 `related_error_signature` 를 추가하고(세 곳 개수 일치), `toIssue(row)` 에 `relatedErrorSignature: row.related_error_signature as string | null` 을 추가한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/api/src/detection/detect.ts apps/api/src/detection/detect.test.ts apps/api/src/db/schema.sqlite.ts apps/api/src/store/sqlite-store.ts apps/api/src/store/store-contract.test.ts
git commit -m "기능: 이슈 오류 서명 조립과 저장"
```

---

## Task 7: 첫 화면 근거 표와 hero 정렬

**Files:**
- Modify: `apps/admin/src/components/IssueDashboardOverview.tsx`
- Modify: `apps/admin/src/components/IssueDashboardOverview.test.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.test.tsx`
- Modify: `apps/admin/src/pages/pages.css`

**Interfaces:**
- Consumes: `Issue.relatedErrorSignature`, `Issue.severityScore`, `representativeEvent.screenContext.target`, 기존 `ScreenContextPreview`, 기존 `severityLevel`/`SEVERITY_LABELS`/`ISSUE_TYPE_LABELS`
- Produces: hero 가 점수 필, 근거 5행 표, 이벤트 캡션을 렌더한다

`ISSUE_TYPE_LABELS` 는 `IssueDashboardOverview.tsx:17` 에 이미 있다. 새로 만들지 말고 그대로 쓴다. (같은 상수가 `IssueTable.tsx:15` 에도 있는 기존 중복은 이번 범위가 아니다.)

- [ ] **Step 1: 실패하는 근거 표 테스트 작성**

`apps/admin/src/components/IssueDashboardOverview.test.tsx` 에 추가한다. 기존 `issue(overrides)` 팩토리와 `summary` 픽스처를 쓴다.

```tsx
it("근거를 항목별 표로 보여주고 오류 서명을 포함한다", () => {
  render(
    <IssueDashboardOverview
      summary={summary}
      issues={[
        issue({
          issueId: "err",
          issueType: "error_friction",
          title: "/checkout 화면에서 오류 기반 막힘이 감지되었습니다",
          severityScore: 90,
          relatedUrlPath: "/checkout",
          affectedSessionsCount: 58,
          affectedUsersCount: 41,
          lastSeenAt: "2026-09-02T01:00:00.000Z",
          relatedErrorSignature: "TypeError · /assets/checkout.js:412",
          representativeEvent: {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/checkout",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "결제하기",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        }),
      ]}
    />,
  );
  const hero = screen.getByRole("region", { name: "가장 먼저 볼 사용자 막힘" });

  expect(within(hero).getByText("화면")).toBeInTheDocument();
  // ScreenContextPreview 의 타이틀 바는 titleMasked 가 없으면 urlPath 로 폴백하므로
  // "/checkout" 이 hero 안에 두 번 나온다. 근거 표로 범위를 좁혀야 모호하지 않다.
  expect(within(hero.querySelector(".friction-hero__facts")!).getByText("/checkout")).toBeInTheDocument();
  expect(within(hero).getByText("클릭")).toBeInTheDocument();
  expect(within(hero).getByText(/button/)).toBeInTheDocument();
  expect(within(hero).getByText("패턴")).toBeInTheDocument();
  // ISSUE_TYPE_LABELS["error_friction"] 의 실제 값은 "오류 마찰" 이다.
  expect(within(hero).getByText("오류 마찰")).toBeInTheDocument();
  expect(within(hero).getByText("오류")).toBeInTheDocument();
  expect(within(hero).getByText("TypeError · /assets/checkout.js:412")).toBeInTheDocument();
  expect(within(hero).getByText("영향")).toBeInTheDocument();
  // hero 안 점수 필
  expect(within(hero).getByText("90")).toBeInTheDocument();
});

it("오류 서명이 없으면 오류 행을 숨긴다", () => {
  render(
    <IssueDashboardOverview
      summary={summary}
      issues={[issue({ issueId: "plain", issueType: "rage_click", severityScore: 70 })]}
    />,
  );
  const hero = screen.getByRole("region", { name: "가장 먼저 볼 사용자 막힘" });

  expect(within(hero).queryByText("오류")).not.toBeInTheDocument();
  expect(within(hero).getByText("패턴")).toBeInTheDocument();
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/components/IssueDashboardOverview.test.tsx`

Expected: FAIL — `화면`/`클릭`/`패턴` 라벨이 없다.

- [ ] **Step 3: hero 마크업 교체**

`IssueDashboardOverview.tsx` 의 `.friction-hero__intro` 와 `.friction-hero__analysis` 를 바꾼다. 헤드라인과 eyebrow, `aria-labelledby`, 다음 액션 문구는 그대로 둔다.

```tsx
      <section className="friction-hero" aria-labelledby="friction-hero-eyebrow">
        <div className="friction-hero__intro">
          <p className="friction-hero__eyebrow" id="friction-hero-eyebrow">
            가장 먼저 볼 사용자 막힘
          </p>
          <div className="friction-hero__headline">
            <h2>{heroTitle}</h2>
            <span className={`friction-hero__score friction-hero__score-${topIssueSeverity}`}>
              <strong>{topIssue.severityScore}</strong>
              <span>{SEVERITY_LABELS[topIssueSeverity]}</span>
            </span>
          </div>
        </div>
        <div className="friction-hero__screen">
          <ScreenContextPreview
            {...(representativeEvent?.screenContext ? { context: representativeEvent.screenContext } : {})}
            {...(representativeEvent ? { event: representativeEvent } : {})}
          />
          {representativeEvent ? (
            <p className="friction-hero__caption">
              {formatKoreanDateTime(representativeEvent.timestamp)} · {topIssue.summary}
            </p>
          ) : null}
        </div>
        <div className="friction-hero__analysis">
          <dl className="friction-hero__facts">
            <div>
              <dt>화면</dt>
              <dd>{topIssue.relatedUrlPath ?? "-"}</dd>
            </div>
            <div>
              <dt>클릭</dt>
              <dd>{clickEvidence}</dd>
            </div>
            <div>
              <dt>패턴</dt>
              <dd>{ISSUE_TYPE_LABELS[topIssue.issueType]}</dd>
            </div>
            {topIssue.relatedErrorSignature ? (
              <div>
                <dt>오류</dt>
                <dd>{topIssue.relatedErrorSignature}</dd>
              </div>
            ) : null}
            <div>
              <dt>영향</dt>
              <dd>
                {topIssue.affectedSessionsCount}세션 · 사용자 {topIssue.affectedUsersCount}명 · 최근{" "}
                {formatKoreanDateTime(topIssue.lastSeenAt)}
              </dd>
            </div>
          </dl>
          <div className="friction-hero__action">
            <dt>다음 액션</dt>
            <dd>해당 화면의 클릭 후 반응, 성공 피드백, 오류 노출 상태를 우선 점검합니다.</dd>
          </div>
        </div>
      </section>
```

`heroTitle` 위에 `clickEvidence` 를 계산한다.

```tsx
  const heroTarget = representativeEvent?.screenContext?.target;
  const clickEvidence = heroTarget
    ? `${heroTarget.tagName}${heroTarget.textMaskedOrLimited ? ` · "${heroTarget.textMaskedOrLimited}"` : ""}`
    : "-";
```

`운영 해석` 항목은 이벤트 캡션이 `topIssue.summary` 를 말하므로 표에서 뺀다. `다음 액션` 은 `<dl>` 밖의 별도 블록으로 옮겨 `getByText("오류")` 가 표 안에서만 매칭되게 한다.

- [ ] **Step 4: 스타일 추가**

`apps/admin/src/pages/pages.css` 의 `.friction-hero` 블록 뒤에 추가한다. 토큰만 쓴다.

```css
.friction-hero__headline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
}

.friction-hero__score {
  display: grid;
  justify-items: center;
  gap: var(--space-1);
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-3) var(--space-5);
}

.friction-hero__score strong {
  color: var(--ink);
  font-size: var(--text-3xl);
}

.friction-hero__score span {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.friction-hero__score-critical strong {
  color: var(--status-crit);
}

.friction-hero__score-warning strong {
  color: var(--status-warn);
}

.friction-hero__caption {
  margin: var(--space-4) 0 0;
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.friction-hero__facts {
  display: grid;
  gap: var(--space-4);
  margin: 0;
}

.friction-hero__facts > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: var(--space-4);
  align-items: baseline;
}

.friction-hero__facts dt {
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: 700;
}

.friction-hero__facts dd {
  margin: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.friction-hero__action {
  margin-top: var(--space-5);
  border-top: 1px solid var(--border);
  padding-top: var(--space-5);
}

.friction-hero__action dt {
  color: var(--ink);
  font-size: var(--text-xs);
  font-weight: 700;
}

.friction-hero__action dd {
  margin: var(--space-2) 0 0;
  color: var(--ink-muted);
  line-height: 1.55;
}
```

타이포 토큰은 확인했다: `--text-xs` 11px, `--text-3xl` 26px (`tokens.css:51-57`). 점수 필은 기존 `.priority-issue-score strong` 의 28px 와 눈높이를 맞추려고 `--text-3xl` 을 쓴다. 원시 px 를 새로 넣지 않는다.

- [ ] **Step 5: priority-issue 카드 그리드 수정**

`.priority-issue` 의 `grid-template-columns: 72px minmax(0, 1fr)` 는 1단계에서 왼쪽 문구를 걷어내 오른쪽이 비었다. 점수와 메타가 채우도록 바꾼다.

```css
.priority-issue {
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
}
```

`.priority-issue-meta` 의 `padding-right: 28px` 는 눈 아이콘 자리이므로 유지한다.

- [ ] **Step 6: 대시보드 페이지 테스트 갱신**

`apps/admin/src/pages/DashboardPage.test.tsx` 의 hero 관련 단정에 근거 표 확인 한 줄을 추가한다.

```tsx
    expect(within(screen.getByRole("region", { name: "가장 먼저 볼 사용자 막힘" })).getByText("패턴")).toBeInTheDocument();
```

기존 `toHaveLength` 단정이 근거 표의 새 텍스트 때문에 깨지면, 무엇이 몇 번 나오는지 확인해 숫자를 맞추고 **왜 바뀌었는지 리포트에 적는다.** 단정을 약화시키지 않는다.

- [ ] **Step 7: 테스트 통과 확인**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin`

Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add apps/admin/src/components/IssueDashboardOverview.tsx apps/admin/src/components/IssueDashboardOverview.test.tsx apps/admin/src/pages/DashboardPage.test.tsx apps/admin/src/pages/pages.css
git commit -m "기능: 첫 화면 근거 표와 hero 점수 필 정렬"
```

---

## Task 8: 실제 수집 데이터로 검증

**Files:**
- Modify: 검증 실패가 Tasks 1-7 이 만든 구체적 버그를 가리킬 때만.

**Interfaces:**
- Consumes: 앞선 모든 태스크
- Produces: 손으로 넣은 시드가 아닌 실제 수집 데이터에서 미리보기가 화면 구조를 담는다는 증거

- [ ] **Step 1: 전체 스위트·타입·빌드**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`
Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck`
Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build`

Expected: 모두 PASS.

- [ ] **Step 2: 번들 크기 보고**

Run: `ls -l packages/sdk/dist/trace.js`

gzip 크기와 예산 대비 여유를 리포트에 적는다. 예산을 넘으면 멈추고 보고한다.

- [ ] **Step 3: 데모 사이트로 실제 수집**

사용자 서버(:4000, :5173)와 충돌하지 않게 별도 포트를 쓴다. API 는 워크트리 기준으로 띄운다 — cwd 가 메인 체크아웃이면 이 브랜치 코드가 아닌 것이 돌아간다. 띄운 뒤 `lsof -a -p <pid> -d cwd` 로 cwd 를 확인한다.

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH NODE_ENV=development PORT=4100 \
  TRACE_DB_PATH=/private/tmp/trace-stage2.db GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy \
  GOOGLE_REDIRECT_URI=http://localhost:4100/auth/google/callback \
  SESSION_SECRET=0123456789abcdef0123456789abcdef ADMIN_APP_ORIGIN=http://localhost:5174 \
  ADMIN_ALLOWED_EMAILS=admin@example.com COOKIE_SECURE=false LOCAL_ADMIN_LOGIN=true npm run dev:api
```

`/auth/local/start` 로 세션 쿠키를 받고(CSRF 헤더 이름은 `x-trace-csrf`), 프로젝트를 만들 때 `allowedDomains` 에 데모 사이트 origin 을 넣는다. `npm run dev:demo` 로 데모 사이트를 띄우고 SDK 스니펫의 endpoint 를 `http://localhost:4100/v1/events/batch` 로 맞춘 뒤 **실제로 클릭한다.**

- [ ] **Step 4: 수집 결과 확인**

DB 를 직접 열어 확인한다.

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH node -e '
const db = require("better-sqlite3")("/private/tmp/trace-stage2.db", {readonly:true});
const rows = db.prepare("SELECT event_id, screen_context FROM events WHERE screen_context IS NOT NULL LIMIT 3").all();
for (const row of rows) {
  const ctx = JSON.parse(row.screen_context);
  console.log(row.event_id, "hints:", ctx.layoutHints.length, "tags:", ctx.layoutHints.map(h => h.tagName).join(","));
  console.log("  masked with text:", ctx.layoutHints.filter(h => h.masked && h.textMaskedOrLimited).length);
}
'
```

Expected: `layoutHints` 가 0보다 크고, `masked` 이면서 텍스트를 가진 힌트가 **0개**다. 0개가 아니면 Task 3 의 서버 집행이 깨진 것이다.

- [ ] **Step 5: 화면 확인**

관리자(`:5174`)를 열어 데모 프로젝트를 선택하고 확인한다.

- hero 미리보기에 nav·폼 영역·입력 필드 블록이 **실제 수집 데이터로** 그려진다.
- 마스킹 블록에 텍스트가 없다.
- 근거 표에 화면·클릭·패턴·영향이 보인다.
- 데모에서 의도적으로 JS 오류를 발생시킨 뒤, 오류 이슈의 근거 표에 `오류` 행이 보인다.
- `한눈에 보기` 카드에 빈 칼럼이 없다.
- 창 너비 390px 에서 hero 가 1단으로 쌓인다.

스크린샷을 남겨 리포트에 경로를 적는다.

- [ ] **Step 6: 정리**

띄운 서버를 종료하고(사용자의 :4000/:5173 은 건드리지 않는다) 임시 DB 를 지운다.

```bash
rm -f /private/tmp/trace-stage2.db
```

- [ ] **Step 7: git 정합성 확인**

Run: `git status --short`

Expected: 이 기능의 파일만 변경돼 있다. 무관한 사용자 변경은 그대로 둔다.

- [ ] **Step 8: 검증 수정이 있었으면 커밋**

Step 1-7 이 코드 변경을 요구했으면 그 파일만 커밋한다. 없으면 빈 커밋을 만들지 않는다.

```bash
git add <정확히 변경한 파일>
git commit -m "수정: 화면 맥락 2단계 검증 이슈 정리"
```

---

## Self-Review

**Spec 커버리지**

| Spec 항목 | 태스크 |
|---|---|
| 힌트 선별 (랜드마크 4 + 이웃 8, 후보 60) | Task 2 |
| 힌트별 필드와 텍스트 화이트리스트 | Task 2 |
| 서버가 masked 텍스트 삭제 | Task 3 |
| throttle 미도입 | Task 2 Step 3 주석에 근거 기록 |
| 오류 식별자 수집 (종류·경로·라인) | Task 4 |
| 오류 계약 필드 | Task 1 |
| 오류 저장 | Task 5 |
| 이슈 오류 서명 | Task 6 |
| 근거 5행 표 | Task 7 |
| 이벤트 캡션 (화면 아래) | Task 7 |
| hero 점수 필 | Task 7 |
| priority-issue 카드 수정 | Task 7 Step 5 |
| 페이지 순서 유지 | 변경 없음 — 태스크 불필요 |
| 성공 기준 (실제 데이터, 예산) | Task 8 |

**Placeholder 스캔:** 모든 코드 스텝에 실제 코드가 있다. Task 7 Step 4 의 `--text-lg`/`--text-xs` 는 토큰 존재 확인을 지시했고, Task 8 Step 8 은 조건부 커밋이다.

**타입 일관성:** `ScreenLayoutHint`(Task 2), `errorName`/`errorSource`/`errorLine`(Task 1 정의 → Task 4 생산 → Task 5 저장 → Task 6 소비), `relatedErrorSignature`(Task 1 정의 → Task 6 생산 → Task 7 소비), `ISSUE_TYPE_LABELS`(Task 7 에서 없으면 생성)가 정의 전에 사용되지 않는다.

**주의:** Task 5 와 Task 6 이 모두 `sqlite-store.ts` 의 INSERT 문 개수 일치를 요구한다. Task 5 는 `events` 22개, Task 6 은 `issues` 컬럼을 늘린다 — 각 태스크에서 컬럼·플레이스홀더·인자 세 곳을 함께 세야 한다.
