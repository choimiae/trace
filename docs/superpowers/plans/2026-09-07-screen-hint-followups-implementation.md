# 화면 힌트 후속 정정 2건 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미리보기에 그려지는 상자에서 겹친 근사 중복을 없애고, 화면 밖 랜드마크가 유령 상자로 들어오는 것을 막는다.

**Architecture:** 두 건 다 `packages/sdk/src/dom.ts` 안의 판정 한 줄씩이다. ①은 힌트를 담는 단계(`collectLayoutHints` 의 `push`)의 중복 판정을 정확 일치에서 4px 근접으로 넓힌다 — 칠해짐 판정이 끝난 뒤라 칠해진 상자를 잃을 위험이 없는 자리다. ②는 `buildLayoutHint` 가 자기 힘으로 rect 를 읽는 경로(랜드마크)의 뷰포트 겹침 판정을 클램프된 값에서 원시 `DOMRect` 로 바꾼다. 계약·수집 API·관리자 렌더러는 건드리지 않는다.

**Tech Stack:** TypeScript(ESM, NodeNext) · vitest + jsdom · 브라우저 DOM API

**Spec:** `docs/superpowers/specs/2026-09-04-screen-hint-collection-design.md` (§1② 뷰포트 판정, §1④ 접기 두 줄이 이번 정정을 담고 있다)

## Global Constraints

- Node `>=22.5.0`. 이 저장소의 `node -v` 는 v22.17.0 이라 PATH 접두가 필요 없다.
- 커밋 메시지는 한국어. `AGENTS.md` 의 프로젝트 규약이다.
- 임포트는 확장자 `.js` 를 붙인 ESM 경로다.
- `tsconfig.base.json` 에 `strict: true` 와 `exactOptionalPropertyTypes: true` 가 켜져 있다. **각 태스크 끝에서 `npm run typecheck` 를 반드시 돌린다** — `npm test` 만으로는 타입 위반이 드러나지 않는다.
- **계약을 바꾸지 않는다.** `packages/shared` 의 `MAX_SCREEN_LAYOUT_HINTS`(20)·`screenLayoutHintSchema`, `apps/api` 의 수집 경로, `apps/admin` 의 렌더러 모두 이번 범위 밖이다. 힌트 개수는 줄어들 수만 있고 계약을 위반할 수 없다.
- **텍스트 정책을 넓히지 않는다.** `TEXT_TAG_WHITELIST`(`button`·`a`·`h1`·`h2`·`h3`)와 `TEXT_ROLE_WHITELIST`(`button`·`link`·`tab`·`heading`)를 건드리지 않는다.
- **SDK 번들 gzip 10,240 B 이내.** 현재 5,830 B. 이번 변경은 수십 바이트 규모다. 초과하면 멈추고 보고한다.
- 기준선: **671 테스트 통과**, `npm run typecheck` exit 0.
- 두 태스크는 같은 파일의 다른 함수를 고친다. 순서대로 하면 충돌이 없다.

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `packages/sdk/src/dom.ts` | DOM → 안전한 메타데이터·화면 맥락 | `collectLayoutHints` 의 중복 판정(Task 1), `buildLayoutHint` 의 뷰포트 게이트(Task 2) |
| `packages/sdk/src/dom.test.ts` | SDK 테스트 | 회귀 테스트 5개 추가, 20개 상한 픽스처 간격 조정 |

**파일을 나누지 않는다.** `dom.ts` 는 현재 약 600줄이고 이번 변경은 순증 20줄 미만이다. 분할은 별도 작업이다.

## Task 순서와 이유

Task 1(근사 중복) → Task 2(랜드마크 게이트) → Task 3(실측 검증).

Task 1 을 먼저 두는 이유는 이것이 파킹된 회귀이고, Task 2 가 랜드마크를 덜 담게 만들어 힌트 개수를 흔들기 때문이다. 개수에 민감한 기존 테스트가 Task 1 에서 한 번, Task 2 에서 또 한 번 흔들리면 어느 변경이 원인인지 구분이 안 된다. Task 3 은 두 건이 다 들어간 뒤에 실제 화면을 본다 — 두 결함 모두 단위 테스트가 아니라 실측에서만 드러난 계열이다.

---

### Task 1: 근사 중복 상자를 담는 단계에서 걸러낸다

**Files:**
- Modify: `packages/sdk/src/dom.ts` (`collectLayoutHints` 의 `seen`·`push`, 현재 508-525행 부근)
- Test: `packages/sdk/src/dom.test.ts` (`근접-동일 rect 접기는 칠해지는 안쪽을 남긴다` describe 바로 뒤에 새 describe)

**Interfaces:**
- Consumes: `isNearSameRect(left: ScreenRect, right: ScreenRect): boolean` — 이미 `dom.ts` 에 있는 모듈 내부 함수다(4px 문턱). 새로 만들지 말고 그대로 부른다. 함수 선언이라 호이스팅되므로 `collectLayoutHints` 보다 아래에 정의돼 있어도 호출할 수 있다.
- Produces: 없음. `collectLayoutHints` 의 시그니처와 반환 타입은 그대로다.

**왜 이 자리인가:** `dropNearParent`(`dom.ts:493`)는 "근접-동일 자식이 있으면 나(부모)를 버린다" 규칙이다. 사슬(부모→자식 한 줄)에서는 안쪽 하나만 남지만, 부모를 꽉 채우는 자식이 **둘 이상인 팬아웃**에서는 부모만 죽고 자식이 둘 다 살아남는다. 두 자식의 rect 가 정확히 같으면 뒤의 `seen` 이 잡지만, 2px 어긋나 있으면 정확 일치 비교를 통과해 겹친 상자가 두 번 그려지고 힌트 칸도 둘을 쓴다. `dropNearParent` 쪽을 고치지 않는 이유는 그 함수가 칠해짐 판정보다 **먼저** 도는 rect 전용 필터라, 거기서 둘 중 하나를 고르면 칠해지지 않은 쪽을 남길 수 있고 그것이 이미 한 번 고친 회귀(상자 통째 소실)다.

- [ ] **Step 1: 팬아웃 근사 중복 회귀 테스트를 쓴다**

`packages/sdk/src/dom.test.ts` 의 `describe("근접-동일 rect 접기는 칠해지는 안쪽을 남긴다", ...)` 블록이 끝나는 줄 바로 다음에 추가한다.

```ts
describe("근사 중복 상자는 힌트에 한 번만 담긴다", () => {
  // dropNearParent 는 "근접-동일 자식이 있으면 부모를 버린다" 라서, 부모를 꽉
  // 채우는 자식이 둘이면 부모만 죽고 자식이 둘 다 남는다. 두 자식의 rect 가
  // 정확히 같지 않으면 정확 일치 비교로는 걸러지지 않아 같은 자리에 상자가
  // 두 번 그려진다. 아이콘+배지처럼 둘 다 셀을 채우는 마크업이 이 모양이다.
  it("부모를 꽉 채우는 형제 둘이 2px 어긋나 있어도 상자는 하나만 담긴다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <div id="cell"><span id="icon"></span><div id="fill"></div></div>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#cell")!, { x: 20, y: 20, width: 80, height: 30 });
    stubRect(document.querySelector("#icon")!, { x: 20, y: 20, width: 80, height: 30 });
    stubRect(document.querySelector("#fill")!, { x: 22, y: 20, width: 78, height: 30 });
    stubStyle(document.querySelector("#icon")!, { backgroundColor: "rgb(200, 200, 200)" });
    stubStyle(document.querySelector("#fill")!, { backgroundColor: "rgb(238, 238, 238)" });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const nearCell = context.layoutHints.filter(
      (hint) =>
        Math.abs(hint.rect.x - 20) < 4 &&
        Math.abs(hint.rect.y - 20) < 4 &&
        Math.abs(hint.rect.width - 80) < 4 &&
        Math.abs(hint.rect.height - 30) < 4,
    );

    expect(nearCell).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t "부모를 꽉 채우는 형제 둘이"`

Expected: FAIL — `expected length: 1, received length: 2`. 두 상자(`{20,20,80,30}` 과 `{22,20,78,30}`)가 모두 담긴다. 여기서 1이 나오면 픽스처가 결함을 재현하지 못한 것이므로 멈추고 보고한다 — 재현 없는 회귀 테스트는 값이 없다.

- [ ] **Step 3: 중복 판정을 4px 근접으로 넓힌다**

`packages/sdk/src/dom.ts` 의 `collectLayoutHints` 도입부에서 다음을 찾는다.

```ts
  const targetRect = rectFromDomRect(target.getBoundingClientRect());
  const seen = new Set<string>();
  const hints: ScreenLayoutHint[] = [];
```

이렇게 바꾼다.

```ts
  const targetRect = rectFromDomRect(target.getBoundingClientRect());
  const pushedRects: ScreenRect[] = [];
  const hints: ScreenLayoutHint[] = [];
```

이어지는 `push` 안에서 다음을 찾는다.

```ts
    if (!built) return;
    const key = `${built.rect.x}:${built.rect.y}:${built.rect.width}:${built.rect.height}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(built.hint);
```

이렇게 바꾼다.

```ts
    if (!built) return;
    // 정확 일치가 아니라 4px 근접으로 본다. dropNearParent 가 부모만 버리는
    // 규칙이라 부모를 꽉 채우는 자식이 둘이면 둘 다 살아남고, 그 둘의 rect 가
    // 정확히 같지 않으면 정확 키로는 걸러지지 않아 겹친 상자가 두 번 그려진다.
    // 접기 단계가 아니라 여기서 보는 이유: 이 지점은 칠해짐 판정이 끝난 뒤라
    // 어느 쪽을 남겨도 "칠해진 상자를 버리고 투명한 것을 남기는" 사고가 없다.
    // 먼저 담긴 쪽이 남는다 — 랜드마크 → 골격(면적 큰 순) → 근처(거리 순) 순서다.
    const builtRect = built.rect;
    if (pushedRects.some((pushed) => isNearSameRect(pushed, builtRect))) return;
    pushedRects.push(builtRect);
    hints.push(built.hint);
```

`hints` 는 `MAX_LAYOUT_HINTS`(20)로 묶여 있으므로 `pushedRects` 순회는 최대 190회 비교다.

- [ ] **Step 4: 새 테스트가 통과하는지 본다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t "부모를 꽉 채우는 형제 둘이"`

Expected: PASS.

- [ ] **Step 5: 전체 스위트를 돌려 흔들린 테스트를 확인한다**

Run: `npm test`

Expected: `후보가 많아도 힌트는 정확히 20개로 잘린다` 를 제외한 모든 테스트가 통과한다. **그 테스트 외에 무엇이든 깨지면 구현이 틀린 것이다** — 픽스처를 고치지 말고 멈추고 보고한다. 특히 `div·table 로만 짠 화면에서 힌트를 10개 이상 담는다`(비시맨틱 픽스처는 힌트가 정확히 10개다)와 `예산이 실제 앱 규모에서 칠해진 상자를 밀어내지 않는다`(≥12)는 근사 중복이 없는 픽스처라 영향을 받지 않아야 한다.

- [ ] **Step 6: 20개 상한 픽스처의 간격을 벌린다**

`후보가 많아도 힌트는 정확히 20개로 잘린다` 의 버튼 80개는 `{ x: index, y: index, width: 40, height: 20 }` 로 **1px 씩** 어긋나 있다. 새 규칙에서 이 80개는 4px 미만 간격의 근사 중복 무리이고, 실제로 담기는 것은 서로 4px 이상 떨어진 대표들뿐이다. 이 테스트의 의도는 "상한 20에서 잘린다" 이므로, 중복 제거가 개수를 결정하지 않도록 간격을 벌린다.

`packages/sdk/src/dom.test.ts` 에서 다음을 찾는다.

```ts
    for (let index = 0; index < 80; index += 1) {
      stubRect(document.querySelector(`#b${index}`)!, { x: index, y: index, width: 40, height: 20 });
    }
```

이렇게 바꾼다.

```ts
    // 8px 씩 벌린다. 1px 간격이면 80개가 전부 서로 4px 미만 — 근사 중복 판정의
    // 한 무리라서, 이 테스트가 재는 것이 "상한 20" 이 아니라 "중복 제거가 남기는
    // 대표 개수" 로 바뀐다. 인덱스 79 도 x=632·y=632 라 1440×900 안에 있다.
    for (let index = 0; index < 80; index += 1) {
      stubRect(document.querySelector(`#b${index}`)!, { x: index * 8, y: index * 8, width: 40, height: 20 });
    }
```

**예상:** 이 픽스처는 고치지 않아도 통과할 수 있다 — 1px 간격 80개에서 4px 이상 떨어진 대표를 그리디로 고르면 마침 20개가 나온다. 그래도 벌리는 이유는 그 20이 상한 때문이 아니라 우연이고, 나중에 버튼 개수나 문턱을 건드리는 사람이 조용히 다른 것을 재게 되기 때문이다. Step 5 에서 이 테스트가 통과했더라도 이 단계는 수행한다.

- [ ] **Step 7: 문턱이 넓어지는 방향의 회귀를 막는 테스트를 쓴다**

Step 1 에서 만든 describe 안, 첫 `it` 뒤에 추가한다.

```ts
  // 반대 방향 가드. 문턱이 넓어지면 진짜로 다른 상자가 조용히 사라진다.
  // 이 테스트는 수정 전에도 통과한다 — 목적은 재현이 아니라 고정이다.
  it("4px 이상 벌어진 두 상자는 둘 다 담긴다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <div id="left"></div>
      <div id="right"></div>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#left")!, { x: 20, y: 20, width: 80, height: 30 });
    stubRect(document.querySelector("#right")!, { x: 20, y: 26, width: 80, height: 30 });
    stubStyle(document.querySelector("#left")!, { backgroundColor: "rgb(200, 200, 200)" });
    stubStyle(document.querySelector("#right")!, { backgroundColor: "rgb(238, 238, 238)" });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const ys = context.layoutHints
      .filter((hint) => hint.rect.x === 20 && hint.rect.width === 80 && hint.rect.height === 30)
      .map((hint) => hint.rect.y)
      .sort((left, right) => left - right);

    expect(ys).toEqual([20, 26]);
  });
```

- [ ] **Step 8: 가드 테스트의 판별력을 확인한다**

`isNearSameRect` 의 문턱 네 개를 임시로 `< 4` 에서 `< 8` 로 바꾸고 돌린다.

Run: `npx vitest run packages/sdk/src/dom.test.ts -t "4px 이상 벌어진 두 상자"`

Expected: FAIL — `expected [20, 26] to equal [20]`(또는 `[20]` 대신 `[26]`). 확인한 뒤 문턱을 `< 4` 로 되돌리고 같은 명령이 PASS 하는 것을 본다. **되돌리는 것을 잊으면 안 된다** — `git diff packages/sdk/src/dom.ts` 로 문턱이 4인지 확인한다.

- [ ] **Step 9: 전체 스위트와 타입을 확인한다**

Run: `npm test`

Expected: PASS. 테스트 수는 671 + 2 = **673**.

Run: `npm run typecheck`

Expected: 출력 없음, exit 0.

- [ ] **Step 10: 번들 크기를 확인한다**

Run: `npm run build --workspace @trace/sdk && gzip -c packages/sdk/dist/trace.js | wc -c`

Expected: 10,240 미만. 기준 5,830 B 에서 수십 바이트 증가가 정상이다.

- [ ] **Step 11: 커밋**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts
git commit -m "수정: 겹친 근사 중복 상자를 힌트에 담을 때 하나로 접는다"
```

---

### Task 2: 랜드마크 뷰포트 판정을 원시 rect 로 옮긴다

**Files:**
- Modify: `packages/sdk/src/dom.ts` (`buildLayoutHint` 도입부, 현재 288-300행 부근)
- Test: `packages/sdk/src/dom.test.ts` (Task 1 이 만든 describe 뒤에 새 describe)

**Interfaces:**
- Consumes: `domRectIntersectsViewport(rect: DOMRect | ClientRect, viewport: ScreenViewport, offset: { x: number; y: number }): boolean` — 이미 `dom.ts:351` 에 있다. `scanBoxes`·`scanFrameBoxes` 가 쓰는 것과 같은 함수를 그대로 부른다. 랜드마크는 프레임 보정이 없으므로 `offset` 은 `{ x: 0, y: 0 }` 이다.
- Produces: 없음. `buildLayoutHint` 의 시그니처와 반환 타입은 그대로다.

**왜 이 자리인가:** `buildLayoutHint` 는 `precomputedRect` 가 없으면 스스로 `getBoundingClientRect()` 를 읽고 `rectFromDomRect` 로 `x`/`y` 를 0 으로 클램프한 **뒤** 겹침을 본다. 그래서 스크롤로 위로 올라간 `<header>`(raw `y:-200`, `height:100`)나 `left:-9999px` 로 숨긴 `<nav>` 가 `y:0`·`x:0` 으로 접혀 뷰포트 안으로 판정되고, 미리보기 왼쪽 위에 유령 상자로 그려진다. `MAX_LANDMARK_HINTS` 가 4라서 그 유령이 진짜 랜드마크 자리까지 빼앗는다. 상자 경로(`scanBoxes`)는 이미 원시 `DOMRect` 로 판정하므로 같은 결함이 랜드마크 경로에만 남아 있다.

- [ ] **Step 1: 화면 밖 랜드마크 회귀 테스트를 쓴다**

Task 1 이 추가한 describe 블록이 끝나는 줄 다음에 추가한다.

```ts
describe("화면 밖 랜드마크는 힌트에 담기지 않는다", () => {
  // rectFromDomRect 는 x/y 를 0 으로 클램프한다. 그 값으로 겹침을 보면 화면
  // 위쪽으로 완전히 벗어난 <header> 가 y:0 으로 접혀 뷰포트 안으로 판정되고,
  // 미리보기 맨 위에 실제로는 보이지 않는 상자가 그려진다. 긴 목록을 스크롤한
  // 뒤 클릭하는 흔한 경로가 이 모양이다.
  it("스크롤로 위로 벗어난 header 는 힌트에 없다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <header id="top"></header>
      <button id="go">저장</button>
    `;
    stubRect(document.querySelector("#top")!, { x: 0, y: -200, width: 1000, height: 100 });
    stubRect(document.querySelector("#go")!, { x: 100, y: 300, width: 96, height: 40 });

    const context = getScreenContext(document.querySelector("#go")!)!;

    expect(context.layoutHints.find((hint) => hint.tagName === "header")).toBeUndefined();
  });

  it("left:-9999px 로 숨긴 nav 는 힌트에 없다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <nav id="drawer"></nav>
      <button id="go">저장</button>
    `;
    stubRect(document.querySelector("#drawer")!, { x: -9999, y: 0, width: 200, height: 600 });
    stubRect(document.querySelector("#go")!, { x: 100, y: 300, width: 96, height: 40 });

    const context = getScreenContext(document.querySelector("#go")!)!;

    expect(context.layoutHints.find((hint) => hint.tagName === "nav")).toBeUndefined();
  });

  // 저장 rect 의 클램프는 그대로 둔다. 게이트만 원시 좌표로 옮기는 변경이라,
  // 걸친 랜드마크는 지금처럼 잘린 채 담겨야 한다. 이 테스트는 수정 전에도
  // 통과한다 — 게이트를 옮기면서 클램프까지 걷어내는 실수를 막는 가드다.
  it("절반만 걸친 header 는 y:0 으로 잘려 담긴다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <header id="top"></header>
      <button id="go">저장</button>
    `;
    stubRect(document.querySelector("#top")!, { x: 0, y: -50, width: 1000, height: 200 });
    stubRect(document.querySelector("#go")!, { x: 100, y: 300, width: 96, height: 40 });

    const context = getScreenContext(document.querySelector("#go")!)!;
    const header = context.layoutHints.find((hint) => hint.tagName === "header");

    expect(header).toBeDefined();
    expect(header?.rect).toEqual({ x: 0, y: 0, width: 1000, height: 200 });
  });
});
```

`<header>`·`<nav>` 에 `stubStyle` 을 걸지 않는 것이 중요하다. 배경도 테두리도 없으면 `isPaintedBox` 에서 탈락해 상자 경로로는 절대 담기지 않으므로, 이 테스트는 랜드마크 경로만 본다.

- [ ] **Step 2: 앞의 두 테스트가 실패하는 것을 확인한다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t "화면 밖 랜드마크는 힌트에 담기지 않는다"`

Expected: 처음 두 개 FAIL, 세 번째 PASS.
- `스크롤로 위로 벗어난 header`: `expected { tagName: 'header', ... } to be undefined` — `y:-200` 이 0 으로 접혀 담긴다.
- `left:-9999px 로 숨긴 nav`: 같은 이유로 `x:-9999` 가 0 으로 접혀 담긴다.

세 번째가 여기서 실패하면 픽스처나 헬퍼 사용이 잘못된 것이므로 멈추고 보고한다.

- [ ] **Step 3: 게이트를 원시 DOMRect 로 옮긴다**

`packages/sdk/src/dom.ts` 의 `buildLayoutHint` 에서 다음을 찾는다.

```ts
  // 호출부가 이미 rect 를 계산했으면 다시 읽지 않는다. iframe 내부 요소는 부모
  // 문서 좌표로 보정된 값이라 여기서 다시 읽으면 프레임 기준으로 되돌아간다.
  const rect = precomputedRect ?? rectFromDomRect(element.getBoundingClientRect());
  if (!intersectsViewportRect(rect, viewport)) return undefined;
```

이렇게 바꾼다.

```ts
  // 호출부가 이미 rect 를 계산했으면 다시 읽지 않는다. iframe 내부 요소는 부모
  // 문서 좌표로 보정된 값이라 여기서 다시 읽으면 프레임 기준으로 되돌아간다.
  let rect: ScreenRect;
  if (precomputedRect !== undefined) {
    // 상자 경로. scanBoxes·scanFrameBoxes 가 이미 원시 좌표로 뷰포트 게이트를
    // 통과시킨 값이다. 여기서 한 번 더 보는 것은 값이 어디서 왔든 뷰포트 밖이
    // 저장되지 않게 하는 보루다.
    if (!intersectsViewportRect(precomputedRect, viewport)) return undefined;
    rect = precomputedRect;
  } else {
    // 랜드마크 경로. 클램프 전 원시 DOMRect 로 판정한다 — rectFromDomRect 가
    // x/y 를 0 으로 접은 뒤에 보면 화면 위·왼쪽으로 완전히 벗어난 <header>·
    // <nav> 가 뷰포트 안으로 잘못 판정돼 미리보기에 유령 상자로 그려지고,
    // 랜드마크 몫 4칸을 진짜 랜드마크에서 빼앗는다. 저장용 rect 의 클램프는
    // 그대로 둔다 — 걸친 랜드마크는 잘린 채 담기는 것이 맞다.
    const domRect = element.getBoundingClientRect();
    if (!domRectIntersectsViewport(domRect, viewport, { x: 0, y: 0 })) return undefined;
    rect = rectFromDomRect(domRect);
  }
```

- [ ] **Step 4: 세 테스트가 모두 통과하는지 본다**

Run: `npx vitest run packages/sdk/src/dom.test.ts -t "화면 밖 랜드마크는 힌트에 담기지 않는다"`

Expected: 3개 PASS.

- [ ] **Step 5: 전체 스위트와 타입을 확인한다**

Run: `npm test`

Expected: PASS. 테스트 수는 673 + 3 = **676**. **무엇이든 깨지면 멈추고 보고한다** — 이번 변경으로 개수가 줄어드는 픽스처는 없어야 한다(기존 랜드마크 픽스처의 `<main>`·`<header>` 는 전부 뷰포트 안에 있다).

Run: `npm run typecheck`

Expected: 출력 없음, exit 0.

- [ ] **Step 6: 번들 크기를 확인한다**

Run: `npm run build --workspace @trace/sdk && gzip -c packages/sdk/dist/trace.js | wc -c`

Expected: 10,240 미만.

- [ ] **Step 7: 커밋**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts
git commit -m "수정: 랜드마크 뷰포트 판정을 클램프 전 원시 rect 로 옮긴다"
```

---

### Task 3: 실측 검증

**Files:**
- Modify: 검증이 Task 1·2 가 만든 구체적 버그를 가리킬 때만.

**Interfaces:**
- Consumes: Task 1·2
- Produces: 실제 제품 화면에서 겹친 중복 상자와 유령 랜드마크가 사라졌다는 증거

두 결함 모두 단위 테스트가 아니라 실제 화면에서만 드러났다. 데모 페이지는 시맨틱 마크업이라 팬아웃도 화면 밖 랜드마크도 잘 나오지 않는다.

- [ ] **Step 1: 서버 세 개를 띄운다**

사용자 서버(:3000, :4000, :5173)와 충돌하지 않게 별도 포트를 쓴다.

```bash
NODE_ENV=development PORT=4100 TRACE_DB_PATH=/private/tmp/trace-hint-followups.db \
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
curl -s -c /tmp/followups-cookies.txt -o /dev/null http://localhost:4100/auth/local/start
CSRF=$(grep __trace_csrf /tmp/followups-cookies.txt | awk '{print $7}')
curl -s -b /tmp/followups-cookies.txt -X POST http://localhost:4100/admin/api/projects \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5174" -H "x-trace-csrf: $CSRF" \
  -d '{"name":"힌트 후속 정정 검증","allowedDomains":["http://localhost:5175","http://localhost:3000"]}'
```

`allowedDomains` 에 `http://localhost:3000` 이 반드시 들어 있어야 한다. 없으면 Step 5 의 수집이 거절된다.

- [ ] **Step 3: 데모 페이지가 나빠지지 않았는지 본다**

`http://localhost:5175/?projectId=<위 id>&port=4100` 을 열고 `권한 추가` 를 여러 번 누른다.

```bash
node -e '
const db = require("better-sqlite3")("/private/tmp/trace-hint-followups.db", {readonly:true});
for (const row of db.prepare("SELECT screen_context FROM events WHERE screen_context IS NOT NULL LIMIT 3").all()) {
  const c = JSON.parse(row.screen_context);
  console.log("힌트", c.layoutHints.length, "|", c.layoutHints.map(h => h.tagName).join(","));
}
'
```

Expected: 힌트 수가 **12 이상**이고 `header`·`main`·`aside` 가 들어 있다. 12 미만이면 중복 제거가 과하게 걷어낸 것이므로 멈추고 보고한다.

- [ ] **Step 4: 겹친 중복 상자가 0인지 기계적으로 확인한다**

```bash
node -e '
const db = require("better-sqlite3")("/private/tmp/trace-hint-followups.db", {readonly:true});
const near = (a, b) =>
  Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4 &&
  Math.abs(a.width - b.width) < 4 && Math.abs(a.height - b.height) < 4;
let pairs = 0, events = 0;
for (const row of db.prepare("SELECT screen_context FROM events WHERE screen_context IS NOT NULL").all()) {
  const hints = JSON.parse(row.screen_context).layoutHints;
  events += 1;
  for (let i = 0; i < hints.length; i += 1)
    for (let j = i + 1; j < hints.length; j += 1)
      if (near(hints[i].rect, hints[j].rect)) pairs += 1;
}
console.log("이벤트", events, "| 근사 중복 쌍", pairs);
'
```

Expected: `근사 중복 쌍 0`. 0이 아니면 Task 1 이 덜 된 것이다 — 어느 이벤트의 어느 쌍인지 찍어서 보고한다.

- [ ] **Step 5: 실제 제품 화면에서 수집한다**

사용자의 앱(`localhost:3000`)에는 SDK 스니펫이 없으므로 검증용으로 콘솔에서 일회성 주입한다. 앱 코드는 바꾸지 않는다.

ONEFFICE 팝업 화면을 열고 콘솔에서:

```js
const s = document.createElement("script");
s.src = "http://localhost:4100/trace.js";
s.dataset.projectId = "<위에서 만든 projectId>";
document.head.appendChild(s);
```

그다음 **두 상태에서** 클릭한다.

1. 스크롤 최상단에서 좌측 패널 항목을 여러 번 클릭한다.
2. 본문을 아래로 스크롤해 **상단 툴바가 화면 밖으로 나간 상태**에서 다시 여러 번 클릭한다. 이 두 번째 상태가 Task 2 가 고친 경로다.

- [ ] **Step 6: 유령 랜드마크가 사라졌는지 확인한다**

```bash
node -e '
const db = require("better-sqlite3")("/private/tmp/trace-hint-followups.db", {readonly:true});
const LANDMARKS = new Set(["header", "nav", "main", "aside"]);
for (const row of db.prepare("SELECT url_path, screen_context FROM events WHERE url_path LIKE @p AND screen_context IS NOT NULL").all({p:"%popup%"})) {
  const c = JSON.parse(row.screen_context);
  const marks = c.layoutHints.filter(h => LANDMARKS.has(h.tagName));
  console.log(row.url_path, "힌트", c.layoutHints.length,
    "| 랜드마크", marks.map(h => `${h.tagName}@${h.rect.y}:${h.rect.height}`).join(",") || "(없음)");
}
'
```

Expected: 스크롤한 상태의 이벤트에서 화면 밖으로 나간 상단 툴바 랜드마크가 **`y:0` 상자로 남아 있지 않다.** 전체 힌트 수는 여전히 **12 이상**이다. 툴바가 화면 안에 있던 첫 번째 상태의 이벤트에는 그 랜드마크가 정상적으로 있어야 한다 — 둘 다 사라졌으면 게이트가 과하게 막는 것이므로 보고한다.

- [ ] **Step 7: 관리자에서 눈으로 확인한다**

`http://localhost:4100/auth/local/start` 로 로그인하고 그 이슈들의 미리보기를 본다.

- 같은 자리에 상자가 두 겹으로 그려진 곳이 없는가
- 스크롤 후 클릭한 이벤트의 미리보기 맨 위에, 실제로는 화면 밖이던 툴바 띠가 남아 있지 않은가
- 좌/우 2단 구조와 클릭 위치는 그대로 드러나는가

스크린샷을 남기고 리포트에 경로를 적는다. 저장 위치는 이 계획의 SDD 워크스페이스 아래 `screenshots/` 다.

- [ ] **Step 8: 정리**

띄운 서버를 종료하고(사용자의 :3000/:4000/:5173 은 건드리지 않는다) 임시 파일을 지운다.

```bash
rm -f /private/tmp/trace-hint-followups.db /tmp/followups-cookies.txt
```

- [ ] **Step 9: git 정합성 확인**

Run: `git status --short`

Expected: 이 작업의 파일만 변경돼 있다. 무관한 사용자 변경은 그대로 둔다.

- [ ] **Step 10: 검증 수정이 있었으면 커밋**

Step 1-9 가 코드 변경을 요구했으면 그 파일만 커밋한다. 없으면 빈 커밋을 만들지 않는다.

```bash
git add <정확히 변경한 파일>
git commit -m "수정: 화면 힌트 후속 정정 실측 검증에서 나온 문제를 고친다"
```

---

## 완료 기준

- 부모를 꽉 채우는 형제가 둘이어도 같은 자리의 상자가 힌트에 한 번만 담긴다.
- 4px 이상 벌어진 상자는 여전히 둘 다 담긴다.
- 화면 위·왼쪽으로 완전히 벗어난 랜드마크는 담기지 않고, 걸친 랜드마크는 `y:0`·`x:0` 으로 잘려 담긴다.
- 테스트 676개 통과, `npm run typecheck` exit 0, SDK 번들 gzip 10,240 B 미만.
- 실제 제품 화면에서 근사 중복 쌍이 0이고 힌트 수가 12 이상으로 유지된다.
- 계약(`packages/shared`)·수집 API(`apps/api`)·관리자 렌더러(`apps/admin`)에 변경이 없다.

## Self-Review

- **스펙 커버리지:** 스펙 §1② 의 "겹침은 클램프 전 원시 `DOMRect` 로 판정하고 이 규칙은 랜드마크 경로에도 적용된다" → Task 2. §1④ 의 "담는 단계에서 rect 가 4px 이내로 겹치면 하나만 남긴다" → Task 1. §1④ 의 접기 방향(부모를 버린다)은 이미 구현돼 있어 새 태스크가 없고, Task 1 Step 1 의 픽스처가 그 방향을 전제로 결함을 재현한다. §5 실측 검증(시드 금지) → Task 3.
- **플레이스홀더 스캔:** TBD·"적절히 처리"·"위와 유사" 없음. 모든 코드 스텝에 실제 코드와 실행할 명령, 기대 출력이 들어 있다. Task 3 Step 5 의 `<위에서 만든 projectId>` 는 Step 2 의 출력을 옮겨 적는 값이라 플레이스홀더가 아니다.
- **타입 정합:** `isNearSameRect`·`domRectIntersectsViewport`·`ScreenRect`·`intersectsViewportRect`·`rectFromDomRect` 는 모두 `dom.ts` 에 이미 있는 이름을 그대로 쓴다. 새로 만드는 식별자는 지역 변수 `pushedRects`·`builtRect`·`domRect` 뿐이고, `built` 의 좁혀진 타입이 클로저 안에서 풀리는 것을 `builtRect` 로 피했다. Task 2 는 `const rect` 를 `let rect: ScreenRect` 로 바꾸므로 `exactOptionalPropertyTypes` 아래에서도 분기별 대입이 성립한다.
