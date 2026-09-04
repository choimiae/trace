# 화면 힌트 수집 사이트 무관화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화면 힌트를 태그 이름이 아니라 "그려진 것"으로 고르게 만들어, `div`·테이블로 짠 화면에서도 미리보기가 화면 구조를 담게 한다.

**Architecture:** 랜드마크 셀렉터(공짜)를 유지한 채 문서 전체를 rect 로 훑고(싼 것), 점수 상위 60개만 `getComputedStyle` 로 "칠해졌는가"를 판정한다(비싼 것). 살아남은 상자를 골격 12 + 클릭 근처 8 로 배분한다. 같은 출처 iframe 은 한 겹 내려가 좌표를 보정하고, 다른 출처는 사각형만 남긴다.

**Tech Stack:** TypeScript(ESM, NodeNext) · zod · vitest + jsdom · 브라우저 DOM API

**Spec:** `docs/superpowers/specs/2026-09-04-screen-hint-collection-design.md`

## Global Constraints

- Node `>=22.5.0`. 이 저장소의 `node -v` 는 이미 v22.17.0 이라 PATH 접두가 필요 없다.
- 커밋 메시지는 한국어. `AGENTS.md` 의 프로젝트 규약이다.
- 임포트는 확장자 `.js` 를 붙인 ESM 경로다.
- `tsconfig.base.json` 에 `strict: true` 와 `exactOptionalPropertyTypes: true` 가 켜져 있다. **각 태스크 끝에서 `npm run typecheck` 를 반드시 돌린다** — `npm test` 만으로는 타입 위반이 드러나지 않는다.
- **텍스트 정책을 넓히지 않는다.** `TEXT_TAG_WHITELIST`(`button`·`a`·`h1`·`h2`·`h3`)와 `TEXT_ROLE_WHITELIST`(`button`·`link`·`tab`·`heading`)를 건드리지 않는다. 새로 후보가 되는 `div`·`td` 는 여기 없으므로 글자가 따라붙지 않는다.
- **SDK 번들 gzip 10KB 이내.** 현재 5,197 B. 초과하면 멈추고 보고한다.
- 기준선: 641 테스트 통과.
- 시드 데이터로 최종 검증하지 않는다. 이 결함이 안 걸린 이유가 검증 대상이 데모 페이지뿐이었기 때문이다.

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `packages/shared/src/events.ts` | 계약 | `layoutHints` 상한 12 → 20 |
| `packages/shared/src/events.test.ts` | 계약 테스트 | 20개 통과·21개 거절 |
| `packages/sdk/src/dom.ts` | DOM → 안전한 메타데이터·화면 맥락 | 상수, 칠해짐 판정, 후보 선정 재작성, iframe |
| `packages/sdk/src/dom.test.ts` | SDK 테스트 | `stubStyle` 헬퍼, 비시맨틱 픽스처, iframe, 비용 상한 |

**파일을 나누지 않는다.** `dom.ts` 는 375줄이고 이번 작업으로 약 520줄이 된다. 요소 지문 쪽과 화면 맥락 쪽이 헬퍼 8개(`allowedElementText`·`isTextEntryElement`·`safeRole`·`rectFromDomRect`·`clampRectValue`·`redactScreenText`·`containsTextEntrySubtree`·`SAFE_TAG_NAME_PATTERN`)를 공유하므로, 분리하면 내부 헬퍼를 대거 export 해야 한다. 동작 변경과 파일 분할을 한 번에 하는 것은 위험하다. 550줄을 넘으면 그때 별도 작업으로 나눈다.

## Task 순서와 이유

Task 1(계약) → 2(칠해짐 판정) → 3(후보 선정) → 4(iframe) → 5(실측 검증).

계약이 먼저여야 Task 3 이 20개를 내보낼 때 수집 API 가 400 을 내지 않는다. 칠해짐 판정은 순수 함수라 후보 선정보다 먼저 독립적으로 못박을 수 있다. iframe 은 후보 선정이 선 뒤에 얹는다.

---

### Task 1: 계약 상한을 20으로 넓힌다

**Files:**
- Modify: `packages/shared/src/events.ts:208`
- Test: `packages/shared/src/events.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `screenContextSchema` 가 `layoutHints` 20개까지 받는다. Task 3 이 20개를 만든다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/events.test.ts` 끝에 추가:

```ts
describe("screenContextSchema layoutHints 상한", () => {
  const hint = (index: number) => ({
    tagName: "div",
    rect: { x: index, y: index, width: 10, height: 10 },
    masked: true,
  });
  const context = (count: number) => ({
    viewport: { width: 1456, height: 828 },
    layoutHints: Array.from({ length: count }, (_, index) => hint(index)),
  });

  it("20개를 받는다", () => {
    const parsed = screenContextSchema.parse(context(20));
    expect(parsed.layoutHints).toHaveLength(20);
  });

  // 상한이 없으면 페이로드가 무한정 커진다. 넓히되 열어 두지는 않는다.
  it("21개를 거절한다", () => {
    expect(() => screenContextSchema.parse(context(21))).toThrow();
  });

  // 넓히는 방향이라 기존에 저장된 12개짜리 데이터가 그대로 유효해야 한다.
  it("기존 12개짜리도 그대로 통과한다", () => {
    expect(screenContextSchema.parse(context(12)).layoutHints).toHaveLength(12);
  });
});
```

`screenContextSchema` 가 임포트돼 있지 않으면 상단 임포트에 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run packages/shared/src/events.test.ts -t "layoutHints 상한"`

Expected: FAIL — 20개 파싱이 `.max(12)` 에 걸려 던진다.

- [ ] **Step 3: 계약을 넓힌다**

`packages/shared/src/events.ts:208` 을 바꾼다:

```ts
  // 20은 실측으로 정했다. 실제 화면 좌표로 12·20·30 예산의 미리보기를 그려 비교한
  // 결과 결정적 차이는 3→12 였고 20→30 은 거의 무의미했다. 20 은 12에서 넘은
  // 문턱에 여유를 둔 값이다. 힌트 하나가 약 90B 라 20개면 screenContext 약 2.2KB 다.
  layoutHints: screenLayoutHintSchema.array().max(20).default([]),
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run packages/shared/src/events.test.ts -t "layoutHints 상한"`

Expected: PASS (3 tests)

- [ ] **Step 5: shared 를 빌드하고 전체·타입체크**

Run: `npm run build --workspace @trace/shared`
Run: `npm test`
Run: `npm run typecheck`

Expected: 모두 PASS. `@trace/api` 와 `@trace/sdk` 는 `dist` 를 보므로 빌드가 먼저다.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared/src/events.ts packages/shared/src/events.test.ts
git commit -m "기능: 화면 힌트 상한을 20으로 넓힌다"
```

---

### Task 2: 칠해짐 판정

**Files:**
- Modify: `packages/sdk/src/dom.ts` (`isMaskedHintElement` 위, 약 225행 앞)
- Test: `packages/sdk/src/dom.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `isPaintedBox(element: Element): boolean` — Task 3 이 후보를 거를 때 쓴다.

- [ ] **Step 1: `stubStyle` 헬퍼를 더한다**

`packages/sdk/src/dom.test.ts` 의 `stubRect`(10행) 바로 아래에 추가한다. jsdom 은 `getComputedStyle` 에 기본값만 주므로 배경색·테두리를 주입해야 한다.

```ts
function stubStyle(element: Element, style: Partial<CSSStyleDeclaration>): void {
  const view = element.ownerDocument.defaultView!;
  const original = view.getComputedStyle.bind(view);
  vi.spyOn(view, "getComputedStyle").mockImplementation((target: Element, pseudo?: string | null) => {
    if (target !== element) return original(target, pseudo ?? undefined);
    return { ...original(target, pseudo ?? undefined), ...style } as CSSStyleDeclaration;
  });
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`dom.test.ts` 끝에 추가:

```ts
describe("isPaintedBox", () => {
  it("배경색이 있으면 상자다", () => {
    document.body.innerHTML = `<div id="a">x</div>`;
    const element = document.querySelector("#a")!;
    stubStyle(element, { backgroundColor: "rgb(240, 240, 240)" });
    expect(isPaintedBox(element)).toBe(true);
  });

  it("테두리가 있으면 상자다", () => {
    document.body.innerHTML = `<div id="a"></div>`;
    const element = document.querySelector("#a")!;
    stubStyle(element, { borderTopWidth: "1px" });
    expect(isPaintedBox(element)).toBe(true);
  });

  it("직접 텍스트 노드가 있으면 상자다", () => {
    document.body.innerHTML = `<div id="a">등록된 연관 문서</div>`;
    expect(isPaintedBox(document.querySelector("#a")!)).toBe(true);
  });

  // 자손의 텍스트는 자기 것이 아니다. 이걸 자기 것으로 세면 조상 래퍼가 전부
  // 상자가 되어 겹겹이 같은 영역을 그린다.
  it("자손의 텍스트만 있으면 상자가 아니다", () => {
    document.body.innerHTML = `<div id="a"><span>글자</span></div>`;
    expect(isPaintedBox(document.querySelector("#a")!)).toBe(false);
  });

  // 대체 요소는 언제나 무언가를 그린다. 배경색·테두리가 없어도 사람 눈에 보인다.
  it("img·iframe·canvas 는 언제나 상자다", () => {
    document.body.innerHTML = `<img id="i"><iframe id="f"></iframe><canvas id="c"></canvas>`;
    for (const id of ["#i", "#f", "#c"]) {
      expect(isPaintedBox(document.querySelector(id)!)).toBe(true);
    }
  });

  it("아무것도 칠해지지 않은 래퍼는 상자가 아니다", () => {
    document.body.innerHTML = `<div id="a"><span>글자</span></div>`;
    const element = document.querySelector("#a")!;
    stubStyle(element, { backgroundColor: "rgba(0, 0, 0, 0)", borderTopWidth: "0px" });
    expect(isPaintedBox(element)).toBe(false);
  });

  it("visibility:hidden 이면 상자가 아니다", () => {
    document.body.innerHTML = `<div id="a">글자</div>`;
    const element = document.querySelector("#a")!;
    stubStyle(element, { visibility: "hidden" });
    expect(isPaintedBox(element)).toBe(false);
  });
});
```

상단 임포트에 `isPaintedBox` 를 더한다. `vi` 가 없으면 `vitest` 임포트에 더한다.

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t isPaintedBox`

Expected: FAIL — `isPaintedBox` 가 없어 임포트가 깨진다.

- [ ] **Step 4: 구현한다**

`packages/sdk/src/dom.ts` 의 `isMaskedHintElement`(225행) 바로 위에 넣는다:

```ts
// 대체 요소는 배경색·테두리가 없어도 언제나 무언가를 그린다.
const REPLACED_TAGS = new Set(["img", "iframe", "frame", "canvas", "video", "svg", "object", "embed"]);

// 판정에만 쓰고 저장하지 않는다. 여기서 읽은 문자열은 이 함수 밖으로 나가지 않는다 —
// 힌트에 실릴 텍스트는 allowsHintText 화이트리스트가 따로 정한다.
function hasOwnTextNode(element: Element): boolean {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? "").trim().length > 0) return true;
  }
  return false;
}

// 태그 이름이 아니라 그려진 결과로 판정한다. 이름은 사이트마다 다르지만
// "칠해졌는가" 는 모든 프레임워크에서 같은 뜻이다.
export function isPaintedBox(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;

  let style: CSSStyleDeclaration;
  try {
    style = view.getComputedStyle(element);
  } catch {
    return false;
  }

  if (style.visibility === "hidden" || style.opacity === "0") return false;
  if (REPLACED_TAGS.has(element.tagName.toLowerCase())) return true;

  const background = style.backgroundColor;
  if (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") return true;

  for (const side of ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"] as const) {
    if (Number.parseFloat(style[side]) > 0) return true;
  }

  if (style.backgroundImage && style.backgroundImage !== "none") return true;

  return hasOwnTextNode(element);
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t isPaintedBox`

Expected: PASS (7 tests)

- [ ] **Step 6: 전체·타입체크**

Run: `npm test`
Run: `npm run typecheck`

Expected: 모두 PASS

- [ ] **Step 7: 커밋**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts
git commit -m "기능: 그려진 결과로 상자를 판정한다"
```

---

### Task 3: 후보 선정을 문서 전체 2단 필터로 바꾼다

**Files:**
- Modify: `packages/sdk/src/dom.ts:14-27` (상수), `:269-278` (`nearestContainer` 제거), `:280-355` (`collectLayoutHints` 재작성)
- Test: `packages/sdk/src/dom.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `isPaintedBox(element)`
- Produces: `collectLayoutHints` 가 문서 전체에서 최대 20개를 고른다. Task 4 가 여기에 iframe 을 얹는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 비시맨틱 픽스처**

`dom.test.ts` 끝에 추가. **실제 제품 화면을 닮은 모양이다** — `<button>` 0개, 랜드마크 0개, `role` 없음, 테이블 레이아웃.

```ts
describe("비시맨틱 화면에서도 구조를 담는다", () => {
  // 실제 제품(ONEFFICE 팝업) 실측: 보이는 요소 633개 중 현재 셀렉터 후보가 3개였다.
  // div 195·td 156·table 65 로 짜여 있고 버튼이 div.btn 92개다. 이 모양을 재현한다.
  function buildNonSemanticScreen(): Element {
    document.body.innerHTML = `
      <div id="shell">
        <div id="toolbar">
          <div id="tool1">저장</div><div id="tool2">인쇄</div><div id="tool3">공유</div>
        </div>
        <table id="layout"><tbody><tr>
          <td id="side"><div id="side1">연관 문서</div><div id="side2">첨부</div></td>
          <td id="body"><div id="doc">본문</div></td>
        </tr></tbody></table>
      </div>`;
    const boxes: Array<[string, { x: number; y: number; width: number; height: number }]> = [
      ["#shell", { x: 0, y: 0, width: 1000, height: 700 }],
      ["#toolbar", { x: 0, y: 0, width: 1000, height: 60 }],
      ["#tool1", { x: 10, y: 15, width: 60, height: 30 }],
      ["#tool2", { x: 80, y: 15, width: 60, height: 30 }],
      ["#tool3", { x: 150, y: 15, width: 60, height: 30 }],
      ["#layout", { x: 0, y: 60, width: 1000, height: 640 }],
      ["#side", { x: 0, y: 60, width: 300, height: 640 }],
      ["#side1", { x: 10, y: 70, width: 280, height: 40 }],
      ["#side2", { x: 10, y: 120, width: 280, height: 40 }],
      ["#body", { x: 300, y: 60, width: 700, height: 640 }],
      ["#doc", { x: 310, y: 70, width: 680, height: 620 }],
    ];
    for (const [selector, rect] of boxes) {
      const element = document.querySelector(selector)!;
      stubRect(element, rect);
      stubStyle(element, { backgroundColor: "rgb(250, 250, 250)", borderTopWidth: "1px" });
    }
    stubRect(document.body, { x: 0, y: 0, width: 1000, height: 700 });
    stubRect(document.documentElement, { x: 0, y: 0, width: 1000, height: 700 });
    return document.querySelector("#side1")!;
  }

  it("div·table 로만 짠 화면에서 힌트를 10개 이상 담는다", () => {
    const target = buildNonSemanticScreen();
    const context = getScreenContext(target)!;

    expect(context.layoutHints.length).toBeGreaterThanOrEqual(10);
    const tags = new Set(context.layoutHints.map((hint) => hint.tagName));
    expect(tags.has("div")).toBe(true);
    expect(tags.has("td")).toBe(true);
  });

  // 구조 힌트는 rect 만 남는다. div·td 는 텍스트 화이트리스트에 없다.
  it("구조 힌트에 글자가 실리지 않는다", () => {
    const target = buildNonSemanticScreen();
    const context = getScreenContext(target)!;

    for (const hint of context.layoutHints) {
      if (hint.tagName === "div" || hint.tagName === "td" || hint.tagName === "table") {
        expect(hint.textMaskedOrLimited).toBeUndefined();
      }
    }
  });

  it("생산자 출력이 계약을 통과한다", () => {
    const target = buildNonSemanticScreen();
    expect(screenContextSchema.safeParse(getScreenContext(target)).success).toBe(true);
  });
});
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 — 시맨틱 회귀 방지와 비용 상한**

같은 파일에 이어서 추가:

```ts
describe("시맨틱 화면이 나빠지지 않는다", () => {
  // 측정에서 확인된 사례: <main>·<header> 는 배경도 테두리도 없는 투명한 껍데기라
  // 칠해짐 판정만으로는 걸리지 않는다. 랜드마크 셀렉터가 이걸 건져야 한다.
  it("아무것도 칠해지지 않은 랜드마크도 힌트로 남는다", () => {
    document.body.innerHTML = `<header id="h"></header><main id="m"><a id="a" href="/x">이동</a></main>`;
    for (const [selector, rect] of [
      ["#h", { x: 0, y: 0, width: 1000, height: 60 }],
      ["#m", { x: 0, y: 60, width: 1000, height: 640 }],
      ["#a", { x: 10, y: 70, width: 80, height: 20 }],
    ] as const) {
      const element = document.querySelector(selector)!;
      stubRect(element, rect);
      stubStyle(element, { backgroundColor: "rgba(0, 0, 0, 0)", borderTopWidth: "0px" });
    }
    const context = getScreenContext(document.querySelector("#a")!)!;
    const tags = context.layoutHints.map((hint) => hint.tagName);
    expect(tags).toContain("header");
    expect(tags).toContain("main");
  });
});

describe("비용 상한", () => {
  // 문서가 커져도 클릭당 비용이 묶여야 한다. getComputedStyle 은 리플로우를 부르므로
  // 호출 횟수가 곧 비용이다. 분노 클릭은 연타라 이 값이 그대로 곱해진다.
  it("getComputedStyle 호출이 클릭당 60을 넘지 않는다", () => {
    const cells = Array.from({ length: 400 }, (_, index) => `<div id="c${index}">${index}</div>`).join("");
    document.body.innerHTML = `<div id="wrap">${cells}</div>`;
    stubRect(document.querySelector("#wrap")!, { x: 0, y: 0, width: 1000, height: 700 });
    for (let index = 0; index < 400; index += 1) {
      stubRect(document.querySelector(`#c${index}`)!, {
        x: (index % 20) * 50, y: Math.floor(index / 20) * 30, width: 48, height: 28,
      });
    }
    const view = document.defaultView!;
    const spy = vi.spyOn(view, "getComputedStyle");

    getScreenContext(document.querySelector("#c0")!);

    expect(spy.mock.calls.length).toBeLessThanOrEqual(60);
    spy.mockRestore();
  });

  // rect 읽기도 공짜가 아니다. 문서가 아무리 커도 스캔이 MAX_RECT_SCAN 에서 멈춰야
  // 클릭당 비용이 문서 크기와 무관해진다.
  it("rect 스캔이 MAX_RECT_SCAN(3000)에서 멈춘다", () => {
    const cells = Array.from({ length: 3200 }, (_, index) => `<div id="d${index}"></div>`).join("");
    document.body.innerHTML = `<div id="wrap">${cells}</div>`;
    let rectCalls = 0;
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function boundingRect(this: Element) {
      rectCalls += 1;
      return { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, toJSON: () => ({}) } as DOMRect;
    };

    try {
      getScreenContext(document.querySelector("#d0")!);
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }

    // 스캔 3000 + 타겟·프레임 등 부수 호출 여유. 3200개를 다 읽으면 이 단정이 깨진다.
    expect(rectCalls).toBeLessThan(3100);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t "비시맨틱"`
Run: `npx vitest run packages/sdk/src/dom.test.ts -t "비용 상한"`

Expected: 둘 다 FAIL — 현재 코드는 `div`·`td` 를 후보로 보지 않아 힌트가 0~2개다.

- [ ] **Step 4: 상수를 바꾼다**

`packages/sdk/src/dom.ts:14-20` 을 바꾼다:

```ts
const MAX_LAYOUT_HINTS = 20;
// 골격 몫. 나머지(20 - 12 = 8)는 클릭 근처가 쓴다. 골격에는 랜드마크가 먼저 들어간다.
const SKELETON_HINTS = 12;
// 랜드마크가 골격 칸을 다 먹지 않게 한다. 랜드마크가 20개인 문서도 있다.
const MAX_LANDMARK_HINTS = 4;
// getComputedStyle 호출 예산이다. 2,360 요소 화면에서 전체를 훑으면 13ms,
// 60개만 보면 0.9ms 로 측정됐다.
const MAX_HINT_CANDIDATES = 60;
// rect 읽기 상한. 2,360 요소에 2.3ms 였다. 거대 문서에서 선형으로 늘어나는 것을 막는다.
const MAX_RECT_SCAN = 3000;
// 이보다 작으면 사람 눈에 상자가 아니다.
const MIN_BOX_SIDE = 8;
// 뷰포트의 이 비율 이상을 덮는 상자는 골격에서 뺀다. <html>·<body> 가 골격 칸을
// 먹으면 화면 전체를 덮는 빈 사각형만 남는다. (스펙 §3 에 없던 규칙 — 근거는 이것이다.)
const SKELETON_MAX_VIEWPORT_RATIO = 0.9;
```

- [ ] **Step 5: `nearestContainer` 를 지우고 후보 선정을 재작성한다**

`nearestContainer`(269-278행)와 `CONTAINER_SELECTOR` 상수(27행)를 지운다. **범위 제한이 헤더·사이드바를 후보에서 빼던 원인이다.**

`NEIGHBOR_SELECTOR` 상수(25-26행)도 지운다. 재작성 후 쓰는 곳이 없어져 죽은 코드가 된다 — 남겨 두면 다음 사람이 "이웃은 이 태그만 본다" 고 오해한다. `LANDMARK_SELECTOR` 는 ① 단계가 계속 쓰므로 남긴다.

`collectLayoutHints`(280-355행)를 통째로 바꾼다:

```ts
interface BoxCandidate {
  element: Element;
  rect: ScreenRect;
  area: number;
  distance: number;
}

function offsetRect(rect: ScreenRect, offset: { x: number; y: number }): ScreenRect {
  return { ...rect, x: clampRectValue(rect.x + offset.x), y: clampRectValue(rect.y + offset.y) };
}

function intersectsViewportRect(rect: ScreenRect, viewport: ScreenViewport): boolean {
  return rect.x < viewport.width && rect.y < viewport.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

// rect 만 읽는다. getComputedStyle 은 아직 부르지 않는다 — 그게 비싼 쪽이다.
function scanBoxes(
  doc: Document,
  viewport: ScreenViewport,
  targetRect: ScreenRect,
  offset: { x: number; y: number },
): BoxCandidate[] {
  const candidates: BoxCandidate[] = [];
  const elements = doc.querySelectorAll("*");
  const limit = Math.min(elements.length, MAX_RECT_SCAN);

  for (let index = 0; index < limit; index += 1) {
    const element = elements[index]!;
    let rect: ScreenRect;
    try {
      rect = offsetRect(rectFromDomRect(element.getBoundingClientRect()), offset);
    } catch {
      continue;
    }
    if (rect.width < MIN_BOX_SIDE || rect.height < MIN_BOX_SIDE) continue;
    if (!intersectsViewportRect(rect, viewport)) continue;
    candidates.push({
      element,
      rect,
      area: rect.width * rect.height,
      distance: rectCenterDistance(rect, targetRect),
    });
  }

  return candidates;
}

// 면적과 거리 양쪽에서 절반씩 뽑는다. 한쪽으로만 뽑으면 다른 쪽이 후보에조차 못 든다.
function budgetedCandidates(candidates: BoxCandidate[]): BoxCandidate[] {
  const half = Math.floor(MAX_HINT_CANDIDATES / 2);
  const byArea = [...candidates].sort((left, right) => right.area - left.area).slice(0, half);
  const byDistance = [...candidates].sort((left, right) => left.distance - right.distance).slice(0, half);
  return Array.from(new Set([...byArea, ...byDistance]));
}

function isNearSameRect(left: ScreenRect, right: ScreenRect): boolean {
  return (
    Math.abs(left.x - right.x) < 4 &&
    Math.abs(left.y - right.y) < 4 &&
    Math.abs(left.width - right.width) < 4 &&
    Math.abs(left.height - right.height) < 4
  );
}

// 래퍼 div 가 겹겹이 쌓인 구조에서 같은 상자를 여러 번 그리는 것을 막는다.
function dropNearParent(candidates: BoxCandidate[]): BoxCandidate[] {
  const byElement = new Map(candidates.map((candidate) => [candidate.element, candidate] as const));
  return candidates.filter((candidate) => {
    const parent = candidate.element.parentElement;
    if (!parent) return true;
    const parentCandidate = byElement.get(parent);
    return parentCandidate === undefined || !isNearSameRect(candidate.rect, parentCandidate.rect);
  });
}

function collectLayoutHints(target: Element, viewport: ScreenViewport): ScreenLayoutHint[] {
  const targetRect = rectFromDomRect(target.getBoundingClientRect());
  const seen = new Set<string>();
  const hints: ScreenLayoutHint[] = [];

  // 힌트 하나가 던져도 화면 맥락 전체를 잃지 않는다. getScreenContext 의 바깥
  // try/catch 에 맡기면 타겟과 뷰포트까지 날아가서 힌트를 안 걷는 것보다 나쁘다.
  const push = (element: Element, rect?: ScreenRect): void => {
    if (element === target || hints.length >= MAX_LAYOUT_HINTS) return;
    let built: ReturnType<typeof buildLayoutHint>;
    try {
      built = buildLayoutHint(element, viewport, rect);
    } catch {
      return;
    }
    if (!built) return;
    const key = `${built.rect.x}:${built.rect.y}:${built.rect.width}:${built.rect.height}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(built.hint);
  };

  // ① 랜드마크 — querySelectorAll 한 번이라 공짜다. 투명해서 칠해짐 판정에 걸리지
  // 않는 <main>·<header> 를 여기서 건진다.
  const landmarks = Array.from(target.ownerDocument.querySelectorAll(LANDMARK_SELECTOR)).slice(
    0,
    MAX_HINT_CANDIDATES,
  );
  for (const landmark of landmarks) {
    if (hints.length >= MAX_LANDMARK_HINTS) break;
    push(landmark);
  }

  // ② rect 스캔 → ③ 예산 안에서만 style 판정 → ④ 칠해짐 + 부모 중복 접기
  const scanned = scanBoxes(target.ownerDocument, viewport, targetRect, { x: 0, y: 0 });
  const painted = budgetedCandidates(scanned).filter((candidate) => isPaintedBox(candidate.element));
  const boxes = dropNearParent(painted);

  // 골격: 면적 큰 순. 화면 전체를 덮는 상자는 아무것도 알려주지 않으므로 뺀다.
  const viewportArea = viewport.width * viewport.height;
  const skeleton = boxes
    .filter((candidate) => candidate.area < viewportArea * SKELETON_MAX_VIEWPORT_RATIO)
    .sort((left, right) => right.area - left.area);
  for (const candidate of skeleton) {
    if (hints.length >= SKELETON_HINTS) break;
    push(candidate.element, candidate.rect);
  }

  // 클릭 근처: 중심 거리 가까운 순. 남은 칸을 채운다. 한쪽이 부족하면 다른 쪽이 메운다.
  const nearby = [...boxes].sort((left, right) => left.distance - right.distance);
  for (const candidate of nearby) {
    if (hints.length >= MAX_LAYOUT_HINTS) break;
    push(candidate.element, candidate.rect);
  }

  return hints;
}
```

- [ ] **Step 6: `buildLayoutHint` 가 계산된 rect 를 받게 한다**

`buildLayoutHint`(236행)의 시그니처와 앞부분을 바꾼다. iframe 내부 요소는 좌표가 보정돼 있어야 하므로 호출부가 rect 를 넘길 수 있어야 한다.

```ts
function buildLayoutHint(
  element: Element,
  viewport: ScreenViewport,
  precomputedRect?: ScreenRect,
): { hint: ScreenLayoutHint; rect: ScreenRect } | undefined {
  const tagName = element.tagName.toLowerCase();
  if (!SAFE_TAG_NAME_PATTERN.test(tagName)) return undefined;

  // 호출부가 이미 rect 를 계산했으면 다시 읽지 않는다. iframe 내부 요소는 부모
  // 문서 좌표로 보정된 값이라 여기서 다시 읽으면 프레임 기준으로 되돌아간다.
  const rect = precomputedRect ?? rectFromDomRect(element.getBoundingClientRect());
  if (!intersectsViewportRect(rect, viewport)) return undefined;
```

그 아래(`const role = ...` 부터)는 그대로 둔다. 기존 `intersectsViewport(domRect, viewport)` 호출을 위 두 줄이 대체하므로, 쓰이지 않게 된 `intersectsViewport` 함수(204행)는 지운다.

- [ ] **Step 7: 통과를 확인한다**

Run: `npx vitest run packages/sdk/src/dom.test.ts`

Expected: PASS

기존 테스트가 깨지면 **단정을 약화시키지 말고** 무엇이 왜 바뀌었는지 확인한다. 범위가 컨테이너에서 문서 전체로 넓어졌으므로 힌트 수가 늘어난 것은 의도된 변화다. 다만 **줄어든 곳이 있으면 그것은 회귀**다 — 멈추고 보고한다.

- [ ] **Step 8: 전체·타입체크·번들 크기**

Run: `npm test`
Run: `npm run typecheck`
Run: `npm run build --workspace @trace/sdk && gzip -c packages/sdk/dist/trace.js | wc -c`

Expected: 테스트·타입체크 PASS, gzip 크기 10240 미만. 초과하면 멈추고 보고한다.

- [ ] **Step 9: 커밋**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts
git commit -m "기능: 화면 힌트를 문서 전체에서 2단 필터로 고른다"
```

---

### Task 4: iframe

**Files:**
- Modify: `packages/sdk/src/dom.ts` (`collectLayoutHints` 의 ② 단계)
- Test: `packages/sdk/src/dom.test.ts`

**Interfaces:**
- Consumes: Task 3 의 `scanBoxes(doc, viewport, targetRect, offset)`, `BoxCandidate`
- Produces: 이 태스크가 마지막 코드 변경이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`dom.test.ts` 끝에 추가:

```ts
describe("iframe", () => {
  // 실측: 실제 제품 팝업의 우측 본문 1056×576 이 통째로 같은 출처 iframe 이었고
  // 내부 요소 31개를 하나도 보지 못해 미리보기 절반이 빈 상자였다.
  it("같은 출처 iframe 내부 상자를 부모 좌표로 보정해 담는다", () => {
    document.body.innerHTML = `<div id="side">사이드</div><iframe id="f"></iframe>`;
    const frame = document.querySelector("#f") as HTMLIFrameElement;
    stubRect(document.querySelector("#side")!, { x: 0, y: 0, width: 300, height: 600 });
    stubRect(frame, { x: 400, y: 100, width: 600, height: 500 });

    // createHTMLDocument 로 만든 문서는 defaultView 가 null 이고, isPaintedBox 는
    // defaultView 가 없으면 곧바로 false 를 돌려준다 — 그러면 내부 상자가 전부
    // 걸러져 구현이 옳아도 이 테스트가 실패한다. 붙인 iframe 의 실제
    // contentDocument 를 쓴다(defaultView 가 있다).
    const innerDoc = frame.contentDocument!;
    innerDoc.body.innerHTML = `<div id="in">문서 본문</div>`;
    const inner = innerDoc.querySelector("#in")!;
    stubRect(inner, { x: 10, y: 20, width: 500, height: 400 });

    const context = getScreenContext(document.querySelector("#side")!)!;
    // iframe 이 x:400,y:100 이므로 내부 x:10,y:20 은 부모 기준 x:410,y:120 이다.
    expect(context.layoutHints).toContainEqual(
      expect.objectContaining({ rect: { x: 410, y: 120, width: 500, height: 400 } }),
    );
  });

  // contentDocument 는 null 을 주고 contentWindow.document 는 SecurityError 를
  // 던진다(2026-09-04 실측). 던지는 쪽을 놓치면 예외가 getScreenContext 바깥
  // try/catch 까지 올라가 화면 맥락이 통째로 사라진다.
  it("다른 출처 iframe 은 건너뛰되 사각형은 남긴다", () => {
    document.body.innerHTML = `<div id="side">사이드</div><iframe id="f"></iframe>`;
    const frame = document.querySelector("#f") as HTMLIFrameElement;
    stubRect(document.querySelector("#side")!, { x: 0, y: 0, width: 300, height: 600 });
    stubRect(frame, { x: 400, y: 100, width: 600, height: 500 });
    Object.defineProperty(frame, "contentDocument", {
      get() { throw new DOMException("blocked", "SecurityError"); },
      configurable: true,
    });

    const context = getScreenContext(document.querySelector("#side")!)!;
    expect(context.layoutHints).toContainEqual(
      expect.objectContaining({ tagName: "iframe", rect: { x: 400, y: 100, width: 600, height: 500 } }),
    );
  });

  it("contentDocument 가 null 이어도 조용히 건너뛴다", () => {
    document.body.innerHTML = `<div id="side">사이드</div><iframe id="f"></iframe>`;
    const frame = document.querySelector("#f") as HTMLIFrameElement;
    stubRect(document.querySelector("#side")!, { x: 0, y: 0, width: 300, height: 600 });
    stubRect(frame, { x: 400, y: 100, width: 600, height: 500 });
    Object.defineProperty(frame, "contentDocument", { value: null, configurable: true });

    expect(() => getScreenContext(document.querySelector("#side")!)).not.toThrow();
  });

  // 같은 출처라도 텍스트 정책은 부모 문서와 같다. div 는 화이트리스트에 없다.
  it("iframe 내부 div 에도 글자가 실리지 않는다", () => {
    document.body.innerHTML = `<div id="side">사이드</div><iframe id="f"></iframe>`;
    const frame = document.querySelector("#f") as HTMLIFrameElement;
    stubRect(document.querySelector("#side")!, { x: 0, y: 0, width: 300, height: 600 });
    stubRect(frame, { x: 400, y: 100, width: 600, height: 500 });
    const innerDoc = frame.contentDocument!;
    innerDoc.body.innerHTML = `<div id="in">비밀 문서 내용</div>`;
    stubRect(innerDoc.querySelector("#in")!, { x: 10, y: 20, width: 500, height: 400 });

    const context = getScreenContext(document.querySelector("#side")!)!;
    for (const hint of context.layoutHints) {
      expect(hint.textMaskedOrLimited).not.toBe("비밀 문서 내용");
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t iframe`

Expected: FAIL — 첫 테스트에서 보정된 좌표의 힌트가 없다.

- [ ] **Step 3: 구현한다**

`packages/sdk/src/dom.ts` 의 `scanBoxes` 아래에 추가한다:

```ts
const FRAME_SELECTOR = "iframe, frame";

// 다른 출처면 contentDocument 가 null 이고, 엔진에 따라 접근 자체가 던진다.
// 두 경우를 모두 여기서 삼킨다 — 밖으로 새면 화면 맥락 전체가 사라진다.
function sameOriginDocument(frame: Element): Document | undefined {
  try {
    return (frame as HTMLIFrameElement).contentDocument ?? undefined;
  } catch {
    return undefined;
  }
}

// 한 겹만 내려간다. 재귀하면 비용이 문서 구조에 따라 예측 불가능해진다.
// 다른 출처 프레임은 여기서 아무것도 더하지 않는다 — 프레임 요소 자체는 부모
// 문서 스캔에서 이미 후보로 잡혔고(REPLACED_TAGS), 그 사각형이 "볼 수 없는 영역"
// 으로 남는다.
function scanFrameBoxes(
  doc: Document,
  viewport: ScreenViewport,
  targetRect: ScreenRect,
): BoxCandidate[] {
  const collected: BoxCandidate[] = [];

  for (const frame of Array.from(doc.querySelectorAll(FRAME_SELECTOR))) {
    let frameRect: ScreenRect;
    try {
      frameRect = rectFromDomRect(frame.getBoundingClientRect());
    } catch {
      continue;
    }
    if (frameRect.width < MIN_BOX_SIDE || frameRect.height < MIN_BOX_SIDE) continue;
    if (!intersectsViewportRect(frameRect, viewport)) continue;

    const innerDoc = sameOriginDocument(frame);
    if (!innerDoc) continue;

    collected.push(...scanBoxes(innerDoc, viewport, targetRect, { x: frameRect.x, y: frameRect.y }));
  }

  return collected;
}
```

그리고 `collectLayoutHints` 의 ② 단계 한 줄을 바꾼다:

```ts
  const scanned = [
    ...scanBoxes(target.ownerDocument, viewport, targetRect, { x: 0, y: 0 }),
    ...scanFrameBoxes(target.ownerDocument, viewport, targetRect),
  ];
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t iframe`

Expected: PASS (4 tests)

- [ ] **Step 5: 전체·타입체크·번들**

Run: `npm test`
Run: `npm run typecheck`
Run: `npm run build --workspace @trace/sdk && gzip -c packages/sdk/dist/trace.js | wc -c`

Expected: PASS, gzip 10240 미만

- [ ] **Step 6: 커밋**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts
git commit -m "기능: 같은 출처 iframe 안을 한 겹 들여다본다"
```

---

### Task 5: 실측 검증

**Files:**
- Modify: 검증 실패가 Tasks 1-4 가 만든 구체적 버그를 가리킬 때만.

**Interfaces:**
- Consumes: 앞선 모든 태스크
- Produces: 데모가 아닌 실제 제품 화면에서 미리보기가 화면 구조를 담는다는 증거

데모 페이지만으로는 이 결함을 다시 놓친다. **데모 페이지에서는 지금 코드도 멀쩡해 보인다.**

- [ ] **Step 1: 서버 세 개를 띄운다**

사용자 서버(:3000, :4000, :5173)와 충돌하지 않게 별도 포트를 쓴다.

```bash
NODE_ENV=development PORT=4100 TRACE_DB_PATH=/private/tmp/trace-hints.db \
  GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy \
  GOOGLE_REDIRECT_URI=http://localhost:4100/auth/google/callback \
  SESSION_SECRET=0123456789abcdef0123456789abcdef ADMIN_APP_ORIGIN=http://localhost:5174 \
  ADMIN_ALLOWED_EMAILS=admin@example.com COOKIE_SECURE=false LOCAL_ADMIN_LOGIN=true npm run dev:api
```

```bash
cd apps/admin && VITE_API_BASE_URL=http://localhost:4100 \
  ../../node_modules/.bin/vite --host 127.0.0.1 --port 5174 --strictPort
```

```bash
npm run dev:demo -- --port 5175 --strictPort
```

`npm run dev:admin -- --port 5174` 는 인자가 전달되지 않아 5173 으로 뜬다. 위처럼 `vite` 를 직접 부른다.

- [ ] **Step 2: 프로젝트를 만든다**

```bash
curl -s -c /tmp/hints-cookies.txt -o /dev/null http://localhost:4100/auth/local/start
CSRF=$(grep __trace_csrf /tmp/hints-cookies.txt | awk '{print $7}')
curl -s -b /tmp/hints-cookies.txt -X POST http://localhost:4100/admin/api/projects \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5174" -H "x-trace-csrf: $CSRF" \
  -d '{"name":"힌트 수집 검증","allowedDomains":["http://localhost:5175","http://localhost:3000"]}'
```

- [ ] **Step 3: 데모 페이지(시맨틱)가 나빠지지 않았는지 본다**

`http://localhost:5175/?projectId=<위 id>&port=4100` 을 열고 `권한 추가` 를 여러 번 누른다.

```bash
node -e '
const db = require("better-sqlite3")("/private/tmp/trace-hints.db", {readonly:true});
for (const row of db.prepare("SELECT screen_context FROM events WHERE screen_context IS NOT NULL LIMIT 3").all()) {
  const c = JSON.parse(row.screen_context);
  console.log("힌트", c.layoutHints.length, "|", c.layoutHints.map(h => h.tagName).join(","));
}
'
```

Expected: 힌트 수가 **12 이상**이고 `header`·`main`·`aside` 가 들어 있다. 12 미만이면 시맨틱 회귀이므로 멈추고 보고한다.

- [ ] **Step 4: 실제 제품 화면에서 수집한다**

사용자의 앱(`localhost:3000`)에 SDK 스니펫이 붙어 있지 않으므로, 검증용으로 브라우저 콘솔에서 임시 주입한다. 이건 검증 목적의 일회성 조작이고 앱 코드를 바꾸지 않는다.

ONEFFICE 팝업 화면을 열고 콘솔에서:

```js
const s = document.createElement("script");
s.src = "http://localhost:4100/trace.js";
s.dataset.projectId = "<위에서 만든 projectId>";
document.head.appendChild(s);
```

그다음 좌측 패널의 항목을 여러 번 클릭한다.

**주의:** Step 2 의 `allowedDomains` 에 `http://localhost:3000` 이 이미 들어 있어야 한다. 없으면 수집이 거절되고 이 단계가 통째로 막힌다.

- [ ] **Step 5: 힌트가 늘었는지 확인한다**

```bash
node -e '
const db = require("better-sqlite3")("/private/tmp/trace-hints.db", {readonly:true});
for (const row of db.prepare("SELECT url_path, screen_context FROM events WHERE url_path LIKE @p AND screen_context IS NOT NULL LIMIT 3").all({p:"%popup%"})) {
  const c = JSON.parse(row.screen_context);
  console.log(row.url_path, "힌트", c.layoutHints.length);
  console.log("  태그:", c.layoutHints.map(h => h.tagName).join(","));
  console.log("  글자 실린 힌트:", c.layoutHints.filter(h => h.textMaskedOrLimited).map(h => h.tagName).join(",") || "(없음)");
}
'
```

Expected: 힌트 **12개 이상**(이전 3개), `div`·`td` 가 포함됨, **글자 실린 힌트에 `div`·`td` 가 없음.**

- [ ] **Step 6: 관리자에서 눈으로 확인한다**

`http://localhost:4100/auth/local/start` 로 로그인하고 그 이슈의 미리보기를 본다.

- 좌/우 2단 구조와 상단 툴바가 드러나는가
- iframe 본문 영역이 더 이상 빈 상자가 아닌가
- 클릭 표시가 실제 누른 위치에 있는가

스크린샷을 남기고 리포트에 경로를 적는다.

- [ ] **Step 7: 정리**

띄운 서버를 종료하고(사용자의 :3000/:4000/:5173 은 건드리지 않는다) 임시 파일을 지운다.

```bash
rm -f /private/tmp/trace-hints.db /tmp/hints-cookies.txt
```

- [ ] **Step 8: git 정합성 확인**

Run: `git status --short`

Expected: 이 기능의 파일만 변경돼 있다. 무관한 사용자 변경은 그대로 둔다.

- [ ] **Step 9: 검증 수정이 있었으면 커밋**

Step 1-8 이 코드 변경을 요구했으면 그 파일만 커밋한다. 없으면 빈 커밋을 만들지 않는다.

```bash
git add <정확히 변경한 파일>
git commit -m "수정: 화면 힌트 실측 검증에서 나온 문제를 고친다"
```

---

## 완료 기준

스펙 §6 을 그대로 옮긴다.

- [ ] 비시맨틱 픽스처에서 힌트 10개 이상 (Task 3 Step 1)
- [ ] 시맨틱 픽스처에서 투명 랜드마크가 남는다 (Task 3 Step 2)
- [ ] `getComputedStyle` 호출이 클릭당 60 이하 (Task 3 Step 2)
- [ ] 다른 출처 iframe 에서 예외가 새지 않고 사각형이 남는다 (Task 4 Step 1)
- [ ] 구조 힌트(`div`·`td`)에 텍스트 0건 (Task 3 Step 1, Task 4 Step 1)
- [ ] SDK 번들 gzip 10KB 이내 (Task 3 Step 8, Task 4 Step 5)
- [ ] 실측: 실제 제품 팝업에서 힌트 12개 이상, 화면 구조를 알아볼 수 있음 (Task 5)
- [ ] 데모 페이지가 나빠지지 않았다 (Task 5 Step 3)
- [ ] 기준선 641 테스트 통과 (각 태스크)
