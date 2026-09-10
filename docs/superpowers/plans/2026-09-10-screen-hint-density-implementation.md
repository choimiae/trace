# 화면 힌트 밀도 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미리보기가 화면의 어느 부분도 통째로 빠뜨리지 않게 담고, 화면에 이름을 하나 붙인다.

**Architecture:** 세 변경이 서로 독립이다. ① `getScreenContext` 가 `document.title` 을 읽어 이미 만들어져 있는 `titleMasked` 파이프라인을 잇는다. ② 예산 상수 셋(shared 계약 상한·SDK 방출 예산·골격 몫)을 함께 20 → 50 으로 올린다. ③ `buildLayoutHint` 가 rect 를 확정한 직후 뷰포트 경계로 잘라, 상자 경로와 랜드마크 경로가 한 지점에서 같은 규칙을 받는다. 관리자 렌더러와 서버 정제는 손대지 않는다.

**Tech Stack:** TypeScript(ESM, NodeNext) · vitest + jsdom · zod(shared 계약) · 브라우저 DOM API

**Spec:** `docs/superpowers/specs/2026-09-10-screen-hint-density-design.md`

## Global Constraints

- Node `>=22.5.0`. 이 저장소의 `node -v` 는 v22.22.3 이라 PATH 접두가 필요 없다.
- 커밋 메시지는 **한국어**. `AGENTS.md` 의 프로젝트 규약이다.
- 임포트는 확장자 `.js` 를 붙인 ESM 경로다.
- `tsconfig.base.json` 에 `strict`·`noUncheckedIndexedAccess`·`exactOptionalPropertyTypes` 가 모두 켜져 있다. **각 태스크 끝에서 `npm run typecheck` 를 반드시 돌린다** — `npm test` 만으로는 타입 위반이 드러나지 않는다.
- 선택 속성은 `...(value ? { key: value } : {})` 스프레드로 넣는다. `exactOptionalPropertyTypes` 때문에 `key: undefined` 를 직접 대입하면 컴파일이 깨진다. 이 파일의 기존 관례다.
- **SDK 번들 gzip 10,240 B 이내.** 현재 5,885 B. 측정: `npm run build && gzip -c packages/sdk/dist/trace.js | wc -c`.
- 기준선: **683 테스트 통과**, `npm run typecheck` exit 0, `npm run build` exit 0.
- 세 태스크는 `packages/sdk/src/dom.ts` 의 서로 다른 지점을 고친다. 순서대로 하면 충돌이 없다.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/sdk/src/dom.ts` | DOM → 안전한 메타데이터·화면 맥락 | 1(`getScreenContext` + 새 헬퍼), 2(상수 20~22행), 3(`buildLayoutHint` + 새 헬퍼) |
| `packages/sdk/src/dom.test.ts` | SDK 테스트 | 1·2·3 |
| `packages/shared/src/events.ts` | 수집 계약(zod) | 2(`MAX_SCREEN_LAYOUT_HINTS`, 203행) |
| `apps/api/src/routes/ingestion.test.ts` | 수집 API 테스트 | 2(20 을 하드코딩한 단언 2곳 + 픽스처 1곳) |
| `README.md` | 개인정보 표 | 1 |
| `docs/superpowers/specs/2026-09-04-screen-hint-collection-design.md` | 옛 스펙 | 3(§1② 문구 정정) |

**파일을 나누지 않는다.** `dom.ts` 는 약 640줄이고 이번 순증은 25줄 미만이다. 분할은 별도 작업이다.

---

## Task 1: 화면 이름을 담는다

**Files:**
- Modify: `packages/sdk/src/dom.ts` (`getScreenContext`, 약 380행 / 새 헬퍼 `screenTitle`)
- Modify: `README.md` (개인정보 표)
- Test: `packages/sdk/src/dom.test.ts`

**Interfaces:**
- Consumes: 기존 `redactScreenText(value: string): string` (`dom.ts:163`), 기존 `expectValidScreenContext(element: Element)` 테스트 헬퍼 (`dom.test.ts:42`)
- Produces: `getScreenContext` 의 반환값에 `titleMasked?: string` 이 채워진다. 후속 태스크는 이 값을 쓰지 않는다.

- [ ] **Step 1a: 테스트 격리를 먼저 고친다**

`document.title` 은 `beforeEach` 가 비우지 않아 한 테스트에서 설정한 값이 이후 모든 테스트로 샌다. 파일 맨 위 `beforeEach`(7행 부근)에 한 줄을 넣는다.

```tsx
beforeEach(() => {
  document.body.innerHTML = "";
  // title 도 비운다. body 와 달리 jsdom 이 자동으로 되돌리지 않아, 한 테스트가
  // 설정한 제목이 이후 모든 테스트의 screenContext 에 실린다.
  document.title = "";
});
```

이걸 먼저 하는 이유: 이 줄이 없으면 Step 1 의 세 번째 테스트가 설정한 123자짜리 제목이 뒤따르는 테스트들로 새어, 이 파일의 기존 주석이 경고한 "재현 불가능한 통과/실패" 를 정확히 만든다.

- [ ] **Step 1: 실패하는 테스트 3개를 쓴다**

`packages/sdk/src/dom.test.ts` 의 `describe("getScreenContext", ...)` 블록 **안 맨 끝**에 넣는다.

```tsx
  // titleMasked 는 계약(screenContextSchema)·서버 정제(sanitizeScreenText)·저장
  // (events.title_masked)·미리보기 제목줄(ScreenContextPreview.tsx:39)이 모두
  // 만들어져 있는데 SDK 가 채우지 않아 통째로 잠들어 있었다. 제목줄이 언제나
  // URL 경로로 폴백해, 해시 라우팅 SPA 의 홈에서 "/" 만 보였다.
  it("화면 제목을 마스킹해 담는다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.title = "결재함 - 더존비즈온";
    document.body.innerHTML = `<div id="click"></div>`;
    stubRect(document.querySelector("#click")!, { x: 10, y: 10, width: 40, height: 20 });

    const context = expectValidScreenContext(document.querySelector("#click")!);

    expect(context.titleMasked).toBe("결재함 - 더존비즈온");
  });

  it("제목이 비어 있으면 titleMasked 를 넣지 않는다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.title = "   ";
    document.body.innerHTML = `<div id="click"></div>`;
    stubRect(document.querySelector("#click")!, { x: 10, y: 10, width: 40, height: 20 });

    const context = expectValidScreenContext(document.querySelector("#click")!);

    // safeScreenTextSchema 가 min(1) 이라 빈 문자열을 넣으면 계약에서 떨어지고
    // 배치 전체가 400 이 된다. 속성 자체를 넣지 않아야 한다.
    expect(context).not.toHaveProperty("titleMasked");
  });

  // 판별력 있는 픽스처다. redactText 는 패턴을 치환한 뒤 slice(0,120) 을 하므로
  // 멱등이 아니다 — 12자리 숫자 뒤에 영문자가 붙어 있으면 1회차에는 \b 경계가
  // 없어 매치되지 않는데, 120자에서 잘려 숫자가 문자열 끝에 오면 2회차에 비로소
  // 매치된다. 그래서 한 번만 마스킹한 값은 계약의 "이미 마스킹된 값" 검증
  // (redactText(v) === v) 을 통과하지 못한다. 실측: 1회 → 120자, 끝이 생숫자.
  // 2회 → 118자, 끝이 [redacted].
  it("제목은 두 번 마스킹해야 계약을 통과한다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.title = `${"가".repeat(108)}123456789012abc`;
    document.body.innerHTML = `<div id="click"></div>`;
    stubRect(document.querySelector("#click")!, { x: 10, y: 10, width: 40, height: 20 });

    // expectValidScreenContext 가 screenContextSchema 로 파싱하므로, 한 번만
    // 마스킹한 구현이면 여기서 떨어진다.
    const context = expectValidScreenContext(document.querySelector("#click")!);

    expect(context.titleMasked).toBe(`${"가".repeat(108)}[redacted]`);
  });
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```bash
npm test --workspace @trace/sdk -- src/dom.test.ts -t "화면 제목"
npm test --workspace @trace/sdk -- src/dom.test.ts -t "두 번 마스킹"
```

기대: 첫 번째는 `expected undefined to be "결재함 - 더존비즈온"`, 세 번째는 `expected undefined to be "가…[redacted]"`. 두 번째("제목이 비어 있으면")는 **지금도 통과한다** — 가드 테스트이고 Step 5 에서 판별력을 실증한다.

- [ ] **Step 3: 최소 구현**

`dom.ts` 의 `redactScreenText`(163행) 바로 아래에 헬퍼를 넣는다.

```ts
// 이벤트마다 읽는다. 페이지 로드 시 한 번만 읽으면 SPA 라우트가 바뀐 뒤에도 옛
// 제목이 남는다. redactScreenText(= redactText 두 번)를 쓰는 이유는
// textMaskedOrLimited 와 같다 — redactText 가 자체 slice(0,120) 때문에 멱등이
// 아니라, 한 번만 돌린 값은 계약의 safeScreenTextSchema(redactText(v) === v)에서
// 떨어지고 배치 전체가 400 이 된다.
function screenTitle(document: Document): string | undefined {
  const masked = redactScreenText((document.title || "").trim()).trim();
  return masked.length === 0 ? undefined : masked;
}
```

`getScreenContext`(약 380행)에서 컨텍스트에 얹는다.

```ts
    const target = buildScreenTarget(element, viewport);
    const titleMasked = screenTitle(element.ownerDocument);

    return {
      viewport,
      ...(titleMasked ? { titleMasked } : {}),
      ...(target ? { target } : {}),
      layoutHints: collectLayoutHints(element, viewport),
    };
```

`element.ownerDocument` 를 쓴다. 이 파일은 전역 `document` 를 쓰지 않고 언제나 `ownerDocument` 를 경유한다(`collectLayoutHints` 의 `target.ownerDocument.querySelectorAll`).

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

```bash
npm test --workspace @trace/sdk -- src/dom.test.ts
npm run typecheck
```

기대: dom.test.ts 전부 통과(83 → 86), typecheck exit 0.

- [ ] **Step 5: 가드 테스트의 판별력을 실증한다**

`screenTitle` 의 마지막 줄을 `return masked;` 로 임시 치환하고 돌린다.

```bash
npm test --workspace @trace/sdk -- src/dom.test.ts -t "비어 있으면"
```

기대: **FAIL** (빈 문자열이 `titleMasked` 로 들어가 계약에서 떨어진다). 확인 후 **반드시 되돌린다.** 되돌린 뒤 다시 돌려 통과를 확인한다.

- [ ] **Step 6: README 개인정보 표에 행을 추가한다**

`README.md` 의 "수집하는 것과 수집하지 않는 것" 표에서 `| 요소 텍스트 |` 행 **바로 아래**에 넣는다.

```markdown
| 페이지 제목 | 마스킹하고 120자로 제한합니다. 제목에 사람 이름이 들어가는 사이트라면 그 이름은 저장됩니다 |
```

- [ ] **Step 7: 전체 검증**

```bash
npm test && npm run typecheck && npm run build
gzip -c packages/sdk/dist/trace.js | wc -c
```

기대: 686 통과, typecheck·build exit 0, gzip 10,240 B 이내.

- [ ] **Step 8: 커밋**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts README.md
git commit -m "$(cat <<'EOF'
기능: 화면 제목을 수집해 미리보기 제목줄을 잇는다

titleMasked 파이프라인이 통째로 잠들어 있었다. 계약·서버 정제·title_masked
컬럼·미리보기 제목줄·hero headline 이 전부 만들어져 있는데 SDK 에
document.title 을 읽는 코드가 없어, 제목줄이 언제나 URL 경로로 폴백했다.
해시 라우팅 SPA 의 홈에서는 그게 "/" 다.

이벤트마다 읽는다. 페이지 로드 시 한 번만 읽으면 SPA 라우트가 바뀐 뒤에도
옛 제목이 남는다.

두 번 마스킹한다. redactText 는 치환 후 slice(0,120) 을 하므로 멱등이 아니고,
한 번만 돌린 값은 계약의 "이미 마스킹된 값" 검증에서 떨어져 배치 전체가
400 이 된다. 회귀 테스트 픽스처가 그 경계를 정확히 짚는다.

개인정보 대가를 README 표에 적었다. redactText 는 이메일·전화·9자리 이상
숫자만 지우므로 제목에 든 사람 이름은 남는다.
EOF
)"
```

---

## Task 2: 예산을 20 에서 50 으로 올린다

**Files:**
- Modify: `packages/shared/src/events.ts:203` (`MAX_SCREEN_LAYOUT_HINTS`)
- Modify: `packages/sdk/src/dom.ts:20,22` (`MAX_LAYOUT_HINTS`, `SKELETON_HINTS`)
- Test: `packages/sdk/src/dom.test.ts:518` · `apps/api/src/routes/ingestion.test.ts:324,363,374`

**Interfaces:**
- Consumes: Task 1 이 만든 것에 의존하지 않는다.
- Produces: 상수 셋의 새 값. `apps/api/src/routes/screen-hint-budget.test.ts` 는 두 상수를 읽어 비교하므로 **수정이 필요 없다** — 값만 따라 움직인다.

- [ ] **Step 1: 20 을 하드코딩한 단언을 50 으로 바꾼다 (실패 상태로)**

`packages/sdk/src/dom.test.ts:518` 의 테스트 이름과 단언을 바꾼다.

```tsx
  it("후보가 많아도 힌트는 정확히 50개로 잘린다", () => {
```

같은 테스트 끝의 단언과 그 위 주석:

```tsx
    // 80개의 버튼 + main 랜드마크가 모두 뷰포트 안에 있으므로 개수는 상한
    // 50으로 결정적이다. <= 50 만 보면 생산자가 조용히 힌트를 덜 채워도 통과한다.
    expect(context.layoutHints.length).toBe(50);
```

`apps/api/src/routes/ingestion.test.ts` 의 두 단언(324행·374행 부근)을 바꾼다.

```ts
    expect(timeline[0]?.screenContext?.layoutHints).toHaveLength(50);
```

그리고 drift 회귀 테스트(331행 부근)의 **이름과 픽스처**를 함께 바꾼다. 픽스처가 20개만 보내면 상한이 50 이어도 통과해 판별력을 잃는다.

```ts
  it("화면 힌트 50개를 계약 상한 그대로 저장한다 (계약-수집 API 상한 drift 회귀 고정)", async () => {
```

```ts
              layoutHints: Array.from({ length: 50 }, (_unused, index) => ({
                tagName: "section",
                masked: false,
                rect: { x: index, y: index, width: 40, height: 40 },
              })),
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```bash
npm test --workspace @trace/sdk -- src/dom.test.ts -t "정확히 50개"
npm test --workspace @trace/api -- src/routes/ingestion.test.ts -t "50개를 계약 상한"
```

기대: 첫 번째는 `expected 20 to be 50`. 두 번째는 계약이 아직 20 이라 50개짜리 페이로드가 스키마에서 떨어져 `expected 202 to be ...` 또는 저장된 힌트가 20개.

- [ ] **Step 3: 상수 셋을 함께 올린다**

`packages/shared/src/events.ts:203`:

```ts
export const MAX_SCREEN_LAYOUT_HINTS = 50;
```

바로 위 주석에 실측 근거를 덧붙인다.

```ts
// 화면 힌트 상한. 계약과 수집 API 가 같은 값을 봐야 한다 — 두 벌로 갈라 두었더니
// 계약만 넓히고 수집 API 가 조용히 12개로 잘라내 기능 전체가 막혔다.
//
// 20 → 50 (2026-09-10). 실제 업무 화면(요소 2,459개) 실측에서 쓸 수 있는 후보가
// 55개인데 20개만 담고 있었다. 20 은 3×3 격자의 7칸만 덮고 하단 아이콘 줄을
// 상자 하나로 대표했다. 50 이면 8칸·4개다.
export const MAX_SCREEN_LAYOUT_HINTS = 50;
```

`packages/sdk/src/dom.ts:20`:

```ts
export const MAX_LAYOUT_HINTS = 50;
```

`packages/sdk/src/dom.ts:22` — 골격 60% 비율을 유지한다.

```ts
// 골격 몫. 나머지(50 - 30 = 20)는 클릭 근처가 쓴다. 골격에는 랜드마크가 먼저 들어간다.
const SKELETON_HINTS = 30;
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

```bash
npm test && npm run typecheck
```

기대: 686 통과(Task 1 이후 기준), typecheck exit 0. `screen-hint-budget.test.ts` 도 통과해야 한다(50 ≤ 50).

- [ ] **Step 5: 상수 드리프트 가드의 판별력을 실증한다**

`packages/sdk/src/dom.ts` 의 `MAX_LAYOUT_HINTS` 만 `51` 로 임시 치환하고 돌린다.

```bash
npm test --workspace @trace/api -- src/routes/screen-hint-budget.test.ts
```

기대: **FAIL** (`51 ≤ 50` 이 아니다). 확인 후 **반드시 50 으로 되돌린다.**

- [ ] **Step 6: 번들 예산을 확인한다**

```bash
npm run build && gzip -c packages/sdk/dist/trace.js | wc -c
```

기대: 10,240 B 이내. 상수 변경이라 바이트 변화는 거의 없다.

- [ ] **Step 7: 커밋**

```bash
git add packages/shared/src/events.ts packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts apps/api/src/routes/ingestion.test.ts
git commit -m "$(cat <<'EOF'
수정: 화면 힌트 예산을 20 에서 50 으로 올린다

실제 업무 화면(요소 2,459개)에서 쓸 수 있는 후보가 55개인데 20개만 담고
있었다. 3x3 격자로 7칸만 덮고, 하단 앱 아이콘 줄은 후보로 91개나 잡혀
4개가 최종 풀까지 살아남는데 20칸에는 1개만 들어갔다 — 골격은 면적 큰
순이라 작은 아이콘이 밀리고 근처는 거리 순이라 화면 아래가 밀린다.

50 이면 격자 8칸, 하단 독 4개, 후보의 91% 다.

상수 셋이 함께 움직여야 한다. 계약 상한만 넓히고 수집 API 가 조용히
좁은 채로 남는 drift 가 한 번 기능을 통째로 막은 적이 있다. 골격 몫은
60% 비율을 유지해 12 에서 30 으로 간다.

drift 회귀 테스트의 픽스처도 20 에서 50 으로 올렸다 — 20개만 보내면
상한이 50 이어도 통과해 판별력을 잃는다.

페이로드는 이벤트당 2.2KB 에서 약 5.5KB. 배치 100건 550KB 로 Fastify
기본 1MB 안이다. 계약을 넓히는 방향이라 기존 데이터는 그대로 유효하다.
EOF
)"
```

---

## Task 3: 뷰포트를 넘는 상자를 잘라 저장한다

**Files:**
- Modify: `packages/sdk/src/dom.ts` (`buildLayoutHint` 약 296~325행 / 새 헬퍼 `clampRectToViewport`)
- Modify: `docs/superpowers/specs/2026-09-04-screen-hint-collection-design.md` (§1② 문구)
- Test: `packages/sdk/src/dom.test.ts`

**Interfaces:**
- Consumes: 기존 타입 `ScreenRect`(`dom.ts:155`), `ScreenViewport`(`dom.ts:156`), 상수 `MIN_BOX_SIDE`(`dom.ts:33`)
- Produces: 없음. 이 태스크가 마지막 코드 변경이다.

- [ ] **Step 1: 실패하는 테스트 3개를 쓴다**

`dom.test.ts` 의 `describe("화면 밖 랜드마크는 힌트에 담기지 않는다", ...)` 블록 **바로 뒤**에 새 describe 를 넣는다.

```tsx
describe("뷰포트를 넘는 상자는 잘려 담긴다", () => {
  // 실측(2026-09-10, 요소 2,459개 화면): 왼쪽 레일 ul 이 48x7894 로 담겼다 —
  // 뷰포트 높이의 10.2배다. 풀뷰포트 제외 가드는 면적 기준(뷰포트 면적의 90%)
  // 이라 얇고 긴 상자를 못 잡는다(48x7894 는 33.7%).
  it("뷰포트보다 긴 상자 경로 rect 는 아래 경계에서 잘린다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <div id="rail"></div>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#rail")!, { x: 0, y: 50, width: 48, height: 7894 });
    stubStyle(document.querySelector("#rail")!, { backgroundColor: "rgb(238, 238, 238)" });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const rail = context.layoutHints.find((hint) => hint.rect.x === 0 && hint.rect.width === 48);

    expect(rail).toBeDefined();
    expect(rail!.rect.height).toBe(650); // 700 - 50
  });

  // 랜드마크는 rect 를 자기 힘으로 읽는 별도 갈래다. 한쪽만 고치면 두 경로가
  // 갈려서, 같은 모양의 요소가 태그에 따라 다르게 저장된다.
  it("뷰포트보다 넓은 랜드마크 rect 도 오른쪽 경계에서 잘린다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <header id="top"></header>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#top")!, { x: 200, y: 0, width: 3000, height: 60 });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const top = context.layoutHints.find((hint) => hint.tagName === "header");

    expect(top).toBeDefined();
    expect(top!.rect.width).toBe(800); // 1000 - 200
  });

  // 자른 뒤 사람 눈에 상자가 아니게 되는 것은 담지 않는다. 뷰포트 겹침 게이트는
  // 1px 만 걸쳐도 통과시키므로, 자르면 두께가 0에 가까운 조각이 남을 수 있다.
  it("잘린 뒤 8px 미만이 되는 상자는 담기지 않는다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <div id="sliver"></div>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#sliver")!, { x: 0, y: 697, width: 400, height: 200 });
    stubStyle(document.querySelector("#sliver")!, { backgroundColor: "rgb(238, 238, 238)" });

    const context = getScreenContext(document.querySelector("#click")!)!;

    expect(context.layoutHints.some((hint) => hint.rect.width === 400)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```bash
npm test --workspace @trace/sdk -- src/dom.test.ts -t "뷰포트를 넘는 상자"
```

기대: 세 개 모두 FAIL. 첫 번째 `expected 7894 to be 650`, 두 번째 `expected 3000 to be 800`, 세 번째 `expected true to be false`.

- [ ] **Step 3: 최소 구현**

`dom.ts` 의 `offsetRect`(355행) 바로 아래에 헬퍼를 넣는다.

```ts
// 뷰포트 밖으로 뻗는 부분은 미리보기에 그릴 수 없다. 자르지 않으면 화면 높이의
// 10배짜리 상자가 그대로 저장돼(실측: 왼쪽 레일 ul 이 48x7894) 미리보기 한쪽을
// 통째로 덮는다. 풀뷰포트 제외 가드는 면적 기준이라 얇고 긴 상자를 못 잡는다.
//
// x/y 의 0 클램프는 그대로 둔다 — 위·왼쪽으로 걸친 요소는 여전히 밀려 담기고,
// 그래서 저장된 상자가 요소의 실제 위쪽 경계를 넘어 그려지는 성질도 그대로다.
// 이 함수가 바꾸는 것은 아래·오른쪽 끝뿐이다.
function clampRectToViewport(rect: ScreenRect, viewport: ScreenViewport): ScreenRect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.min(rect.width, Math.max(0, viewport.width - rect.x)),
    height: Math.min(rect.height, Math.max(0, viewport.height - rect.y)),
  };
}
```

`buildLayoutHint` 에서 `rect` 를 확정하는 if/else **바로 뒤**, `const role = safeRole(...)` **앞**에 한 지점으로 적용한다. 두 갈래가 여기서 합류하므로 규칙이 한 번만 쓰인다.

```ts
  // 두 갈래(상자 경로·랜드마크 경로)가 여기서 합류한다. 자르기를 이 한 지점에
  // 두어야 같은 모양의 요소가 태그에 따라 다르게 저장되지 않는다.
  rect = clampRectToViewport(rect, viewport);
  if (rect.width < MIN_BOX_SIDE || rect.height < MIN_BOX_SIDE) return undefined;

  const role = safeRole(element.getAttribute("role") ?? tagName);
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

```bash
npm test && npm run typecheck
```

기대: 689 통과, typecheck exit 0. **기존 테스트가 깨지면 멈추고 보고한다** — 특히 `절반만 걸친 header 는 y:0 으로 밀려 담긴다`(dom.test.ts 약 1284행)는 y 가 0 으로 밀린 뒤 높이가 뷰포트 안에 들어가므로 영향이 없어야 한다.

- [ ] **Step 5: 두 갈래를 각각 실증한다**

랜드마크 갈래만 우회하도록 임시로 바꿔 본다 — `rect = clampRectToViewport(rect, viewport);` 를 `if (precomputedRect !== undefined) rect = clampRectToViewport(rect, viewport);` 로 치환하고 돌린다.

```bash
npm test --workspace @trace/sdk -- src/dom.test.ts -t "랜드마크 rect 도 오른쪽"
```

기대: **FAIL**. 두 갈래가 정말 한 지점을 공유하는지 확인하는 것이다. 확인 후 **반드시 되돌린다.**

- [ ] **Step 6: 옛 스펙의 문구를 정정한다**

`docs/superpowers/specs/2026-09-04-screen-hint-collection-design.md` §1② 의 두 번째 불릿에서, `width`/`height` 를 손대지 않는다고 적은 부분을 고친다. 해당 문장은 "저장용 rect 는 `x`/`y` 를 0 으로 클램프하는데…" 로 시작하는 대목이다. 아래를 그 불릿 끝에 덧붙인다.

```markdown
**(2026-09-10 정정)** `width`/`height` 는 이제 뷰포트의 오른쪽·아래 경계에서 잘린다. 자르지 않았더니 화면 높이의 10.2배짜리 상자(실측: `48×7894`)가 그대로 저장돼 미리보기 한쪽을 덮었고, 풀뷰포트 제외 가드는 면적 기준이라 얇고 긴 상자를 잡지 못했다. `x`/`y` 의 0 클램프는 그대로이므로, 위·왼쪽으로 걸친 요소가 밀려 담겨 실제 위쪽 경계를 넘어 그려지는 성질은 유지된다 — 바뀐 것은 아래·오른쪽 끝뿐이다. 자른 뒤 8px 미만이 되는 상자는 담지 않는다.
```

- [ ] **Step 7: 전체 검증**

```bash
npm test && npm run typecheck && npm run build
gzip -c packages/sdk/dist/trace.js | wc -c
```

기대: 689 통과, exit 0, gzip 10,240 B 이내.

- [ ] **Step 8: 커밋**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts docs/superpowers/specs/2026-09-04-screen-hint-collection-design.md
git commit -m "$(cat <<'EOF'
수정: 뷰포트를 넘는 상자를 경계에서 잘라 저장한다

실측에서 왼쪽 레일 ul 이 48x7894 로 담겼다 — 화면 높이의 10.2배다.
미리보기 한쪽을 통째로 덮는다. 풀뷰포트 제외 가드가 면적 기준(뷰포트
면적의 90%)이라 얇고 긴 상자는 33.7% 로 통과한다.

상자 경로와 랜드마크 경로가 합류하는 buildLayoutHint 의 한 지점에서 자른다.
한쪽만 고치면 같은 모양의 요소가 태그에 따라 다르게 저장된다.

x/y 의 0 클램프는 그대로다. 위·왼쪽으로 걸친 요소가 밀려 담겨 실제 위쪽
경계를 넘어 그려지는 성질은 유지되고, 바뀐 것은 아래·오른쪽 끝뿐이다.
그 성질을 명시한 옛 스펙 문구를 정정했다.

자른 뒤 8px 미만이 되는 조각은 담지 않는다. 뷰포트 겹침 게이트가 1px 만
걸쳐도 통과시키기 때문이다.
EOF
)"
```

---

## Task 4: 실제 화면에서 실측한다

**Files:** 없음(검증 전용). 코드 결함이 나오면 그때 파일이 정해진다.

**Interfaces:**
- Consumes: Task 1·2·3 이 모두 병합된 상태.
- Produces: 스펙 §6 실측 표를 채울 숫자.

> **이 태스크는 컨트롤러가 직접 수행한다.** 서브에이전트에 위임하지 않는다 — 구현이 아니라 검증이고, 브라우저 세션과 사용자의 실제 앱(:3000)이 이 세션에 있으며, 사람이 미리보기를 보고 판단하는 항목이 핵심이다. 지난 세 계획에서 같은 판정을 했고 그 판정이 Critical 1건과 Important 2건을 잡아냈다.

- [ ] **Step 1: 서버를 띄운다**

```bash
npm run dev:api    # :4000
npm run dev:admin  # :5173
```

사용자의 앱(:3000)은 이미 떠 있다. **건드리지 않는다.**

- [ ] **Step 2: 실제 앱에서 이벤트를 수집한다**

프로젝트 `proj_gB9mBSeMs6` 의 허용 도메인이 `http://localhost:3000` 하나이므로 그 앱에서만 수집할 수 있다. 그 앱은 클릭 후보가 전부 실제 메뉴·링크(`span.module-link`)라 **앱 동작을 건드리지 않도록 핸들러 없는 임시 요소**를 올려 거기에만 클릭을 보내고 제거한다. 화면 정중앙에 둔다 — 왼쪽 레일 옆에 두면 근처 랭킹이 레일에 유리해져 분포가 왜곡된다(지난 측정에서 레일이 4칸에서 9칸으로 부풀었다).

- [ ] **Step 3: DB 에서 숫자를 확인한다**

```bash
node -e "
const D=require('better-sqlite3');const db=new D('apps/api/trace.db',{readonly:true});
const r=db.prepare(\"SELECT title_masked, screen_context FROM events WHERE screen_context IS NOT NULL ORDER BY timestamp DESC LIMIT 1\").get();
const c=JSON.parse(r.screen_context);
const vh=c.viewport.height, vw=c.viewport.width;
const cell=(h)=>Math.min(2,Math.floor((h.rect.x+h.rect.width/2)/(vw/3)))+3*Math.min(2,Math.floor((h.rect.y+h.rect.height/2)/(vh/3)));
console.log('title_masked   :', JSON.stringify(r.title_masked));
console.log('힌트 수         :', c.layoutHints.length);
console.log('덮은 격자칸     :', new Set(c.layoutHints.map(cell)).size, '/ 9');
console.log('하단 독         :', c.layoutHints.filter(h=>h.rect.y>vh-140&&h.rect.width<120).length);
console.log('뷰포트 초과 상자:', c.layoutHints.filter(h=>h.rect.y+h.rect.height>vh||h.rect.x+h.rect.width>vw).length);
"
```

기대:

| 항목 | 값 |
|---|---|
| `title_masked` | `"더존비즈온(DEV)1"` (기존 `null`) |
| 힌트 수 | 50 (기존 20) |
| 덮은 격자칸 | 8 / 9 (기존 7) |
| 하단 독 | 4 (기존 1) |
| 뷰포트 초과 상자 | **0** (기존 1) |

- [ ] **Step 4: 관리자 미리보기를 눈으로 확인한다**

`http://localhost:5173` 을 열어 첫 화면 hero 를 본다. 제목줄이 `/` 가 아니라 화면 이름으로 바뀌었는지, 왼쪽에 화면 높이를 넘는 긴 띠가 사라졌는지, 상자가 화면 전체에 고루 퍼졌는지 확인하고 스크린샷을 남긴다.

**글자는 여전히 0건이라 상자가 익명인 것이 정상이다.** 그것은 이 계획의 범위가 아니다(스펙 §7).

- [ ] **Step 5: 스펙의 실측 표를 실제 값으로 채운다**

`docs/superpowers/specs/2026-09-10-screen-hint-density-design.md` §6 실측 표의 "기대" 열을 실측값으로 바꾸고, 다르면 왜 다른지 적는다.

- [ ] **Step 6: 정리하고 커밋한다**

실측용으로 만든 합성 이벤트와 그것이 만든 이슈를 지운다. 서버 중 자신이 띄운 것만 내린다(**:3000 은 사용자 것이라 유지**).

```bash
git add docs/superpowers/specs/2026-09-10-screen-hint-density-design.md
git commit -m "문서: 화면 힌트 밀도 실측 결과를 스펙에 채운다"
```

코드 결함이 0건이면 빈 커밋을 만들지 않는다.

---

## Self-Review

**스펙 커버리지**

| 스펙 절 | 태스크 |
|---|---|
| §1 화면 이름 | Task 1 Step 1~5 |
| §1 개인정보 · README 행 | Task 1 Step 6 |
| §2 예산 20 → 50 (상수 셋) | Task 2 Step 3 |
| §2 페이로드 | Task 2 커밋 메시지에 근거 기록 |
| §3 뷰포트 클램프 (두 경로) | Task 3 Step 3·5 |
| §3 옛 스펙 문구 정정 | Task 3 Step 6 |
| §4 새 랭킹 규칙 없음 | 해당 태스크 없음 — **의도된 부재**. 코드 변경이 없다 |
| §5 계약·서버·관리자 | Task 2(계약 상수 하나). 서버·관리자 변경 없음 |
| §6 단위 테스트 6건 | Task 1 에 3건, Task 3 에 3건. 예산 테스트는 기존 것이 상수를 따라 움직인다 |
| §6 실측 | Task 4 |
| §7 남는 한계 | 코드 변경 없음. Task 4 Step 4 가 "글자 0건은 정상" 으로 명시 |

빈 곳 없음.

**플레이스홀더 스캔:** "TBD"·"적절히"·"비슷하게" 없음. 모든 코드 스텝에 실제 코드가 있다.

**타입 일관성:** `clampRectToViewport(rect: ScreenRect, viewport: ScreenViewport): ScreenRect` 와 `screenTitle(document: Document): string | undefined` 가 각각 Task 3·1 에서 한 번씩만 정의되고 이름이 어긋나는 곳이 없다. `MIN_BOX_SIDE`·`MAX_LAYOUT_HINTS`·`SKELETON_HINTS`·`MAX_SCREEN_LAYOUT_HINTS` 는 전부 기존 상수이고 위치를 행 번호로 지정했다.
