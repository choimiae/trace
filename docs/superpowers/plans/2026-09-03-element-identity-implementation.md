# 요소 신원 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서로 다른 컨트롤이 서로 다른 요소로 인식되게 만들어, 없는 분노 클릭 이슈를 만들지 않고 서로 다른 버튼의 문제를 한 이슈로 병합하지 않는다.

**Architecture:** 두 층에서 고친다. SDK 는 지문 문자열에 조상 구조와 개발자가 쓴 안정 속성을 넣고 해시를 64비트로 넓힌다. 서버는 지문 단독이 아니라 `(지문, 이미 저장된 마스킹 글자)` 쌍으로 요소 동일성을 판정하고, 이슈 id 에는 그 쌍을 hex 로 접어 넣는다. 배포 후 과거 이벤트의 옛 지문이 틀린 이슈를 영구히 재생성하므로 `PRAGMA user_version` 으로 가드한 일회성 마이그레이션이 옛 지문을 무효화하고 해시로 키잉된 이슈 행만 지운다.

**Tech Stack:** TypeScript, Zod, Vitest, jsdom, Fastify, better-sqlite3, SQLite

**Spec:** `docs/superpowers/specs/2026-09-03-element-identity-design.md`

## Global Constraints

- 입력 계열 요소(`input`/`textarea`/`contenteditable`)와 컨테이너의 텍스트는 저장하지 않는다.
- `masked: true` 인 힌트는 텍스트를 담지 않는다.
- 페이지 제목(`document.title`)은 수집하지 않는다.
- 오류 메시지 본문과 스택은 수집하지 않는다.
- 수집 실패는 고객 사이트 동작에 영향을 주지 않는다. 수집 경로의 예외는 삼켜서 필드를 생략한다.
- 수집 API 는 거절이 아니라 정리한다. 잘못된 값은 필드만 버리고 배치는 202 로 받는다.
- SDK 번들은 gzip 예산 10KB 안에 있어야 한다 (현재 4854B, `packages/sdk/src/bundle-size.test.ts`).
- 요소 지문은 계약 `ELEMENT_SELECTOR_HASH_PATTERN = /^[0-9a-f]{1,16}$/i` 을 통과해야 한다. **계약을 바꾸지 않는다.**
- 지문에 사용자 텍스트(`aria-label`·`textContent`)와 클래스를 넣지 않는다.
- `nth-of-type` 등 형제 순서번호를 지문에 넣지 않는다. 목록 행마다 있는 같은 컨트롤은 하나의 요소여야 한다.
- 관리자 화면 문구와 커밋 메시지는 한국어를 기본으로 한다.
- 상대 임포트는 명시 `.js` 확장자를 쓴다.
- **SDK(`packages/sdk`)는 런타임 함수를 배럴이 아니라 서브패스로 가져온다** — `dom.ts`·`client.ts` 가 이미 `@trace/shared/privacy` 를 쓰고 `packages/sdk/vitest.config.ts` 에 그 alias 가 bare `@trace/shared` 보다 먼저 등록돼 있다. 루트 배럴로 가져오면 `events.ts` 의 zod 스키마가 번들에 끌려와 gzip 예산을 넘긴다(실측 21074B). 서브패스를 새로 쓸 때는 `packages/shared/package.json` 의 `exports` 와 `packages/sdk/vitest.config.ts` 의 alias 를 함께 추가한다.
- API(`apps/api`)와 테스트 파일은 번들되지 않으므로 `@trace/shared` 루트에서 가져와도 된다 (`apps/api/vitest.config.ts` 가 루트를 소스로 alias 한다). `@trace/shared/events` 서브패스는 존재하지 않는다.
- 기존 미커밋 변경 파일은 이 계획 실행 중 임의로 되돌리지 않는다.

---

## File Structure

- Modify: `packages/sdk/src/dom.ts`
  - `buildSelector` 가 조상 태그 체인·안정 속성을 포함하고, `:` 를 포함한 id 를 건너뛴다. `hashSelector` 가 16 hex 를 낸다.
- Modify: `packages/sdk/src/dom.test.ts`
  - 구조로 갈리는지, 목록 행처럼 같은 것은 안 갈리는지, 생성 id 가 무시되는지, 해시 폭이 고정인지 검증.
- Create: `apps/api/src/detection/element-identity.ts`
  - `sameElement(left, right)` 와 `elementKey(event)`. 탐지기가 요소 신원을 판정하는 단일 지점.
- Create: `apps/api/src/detection/element-identity.test.ts`
  - 쌍 비교와 키 조립의 경계(글자 없음, 지문 없음, 한글 글자) 검증.
- Modify: `apps/api/src/detection/detect.ts`
  - 분노 클릭 군집 비교를 `sameElement` 로, `makeIssue` 에 넘기는 값을 `elementKey` 로 바꾼다.
- Modify: `apps/api/src/detection/url.ts`
  - `issueTargetKey` 의 입력 필드명을 `selectorHash` → `elementKey` 로 바꾼다. `"page"` 폴백은 유지.
- Modify: `apps/api/src/detection/detect.test.ts`
  - 구조가 같고 글자만 다른 클릭이 갈리는지, 한글 글자가 id 에서 뭉개지지 않는지, 오류 이슈 id 가 그대로인지 검증.
- Modify: `apps/api/src/store/sqlite-store.ts`
  - `migrate()` 끝에 `user_version` 가드 일회성 데이터 마이그레이션 추가.
- Modify: `apps/api/src/store/sqlite-store.test.ts`
  - 마이그레이션이 옛 지문을 무효화하고 해시 키 이슈만 지우는지, 두 번 실행돼도 새 지문을 지우지 않는지 검증.
- Modify: `apps/api/src/store/store-contract.test.ts`
  - 두 스토어가 `elementSelectorHash` 와 `elementTextMaskedOrLimited` 를 모두 왕복 보존하는지 검증(탐지기가 두 스토어에서 같은 입력을 보게 되는 근거).

---

## Task 1: SDK 지문 문자열과 해시 폭

**Files:**
- Create: `packages/shared/src/hash.ts`
- Create: `packages/shared/src/hash.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/sdk/src/dom.ts`
- Modify: `packages/sdk/src/dom.test.ts`

**Interfaces:**
- Consumes: `isSafeElementSelectorHash` from `@trace/shared` (테스트에서만)
- Produces:
  - `export function hash64Hex(input: string): string` from `@trace/shared` — 임의 문자열을 정확히 16 hex 로 접는다. **Task 2 가 이 함수를 소비한다.**
  - `buildSelector` 는 모듈 내부 함수로 남는다(export 하지 않는다). 관측은 `getElementMetadata(element).elementSelectorHash` 로 한다.
  - `getElementMetadata` 의 반환 형태는 바뀌지 않는다. `elementSelectorHash` 가 항상 정확히 16 hex 문자열이 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/sdk/src/dom.test.ts` 의 `describe("getElementMetadata", ...)` 블록 **뒤에** 새 describe 를 추가한다. 파일 상단에 이미 `import { beforeEach, describe, expect, it, vi } from "vitest";` 와 `getElementMetadata` 임포트가 있으므로 임포트는 추가하지 않는다. `isSafeElementSelectorHash` 만 추가로 가져온다. 파일 1행에 이미 `import { screenContextSchema } from "@trace/shared";` 가 있으므로 **새 임포트 줄을 만들지 말고 그 줄에 더한다** (`isSafeElementSelectorHash` 는 `packages/shared/src/index.ts` 의 `export * from "./privacy.js"` 를 통해 루트에서 나온다):

```ts
import { isSafeElementSelectorHash, screenContextSchema } from "@trace/shared";
```

그리고 다음 블록을 추가한다:

```ts
describe("요소 지문", () => {
  function render(html: string): void {
    document.body.innerHTML = html;
  }

  function hashOf(selector: string): string {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`요소를 찾지 못했다: ${selector}`);
    return getElementMetadata(element).elementSelectorHash!;
  }

  it("구조가 다른 버튼은 지문이 갈린다", () => {
    render(`
      <main>
        <form><button type="submit" id="save">저장</button></form>
        <div class="button-group">
          <button id="export">리포트 내보내기</button>
        </div>
      </main>
    `);

    expect(hashOf("#save")).not.toBe(hashOf("#export"));
  });

  it("id·role·속성이 없어도 조상 구조가 다르면 갈린다", () => {
    render(`
      <main>
        <form><button>저장</button></form>
        <div><button>리포트 내보내기</button></div>
      </main>
    `);

    const [inForm, inDiv] = Array.from(document.querySelectorAll("button"));
    expect(getElementMetadata(inForm!).elementSelectorHash).not.toBe(
      getElementMetadata(inDiv!).elementSelectorHash,
    );
  });

  it("안정 속성이 다르면 갈린다", () => {
    render(`
      <main><div>
        <input type="text" name="workspaceName" />
        <input type="email" name="ownerEmail" />
      </div></main>
    `);

    const [text, email] = Array.from(document.querySelectorAll("input"));
    expect(getElementMetadata(text!).elementSelectorHash).not.toBe(
      getElementMetadata(email!).elementSelectorHash,
    );
  });

  it("목록 행처럼 구조·속성이 같은 반복 컨트롤은 하나의 요소로 유지된다", () => {
    render(`
      <main><table><tbody>
        <tr><td><button class="row-3">삭제</button></td></tr>
        <tr><td><button class="row-5">삭제</button></td></tr>
      </tbody></table></main>
    `);

    expect(hashOf(".row-3")).toBe(hashOf(".row-5"));
  });

  it("콜론을 포함한 생성 id 는 지문에 넣지 않는다", () => {
    render(`<main><div><button id=":r1:">저장</button></div></main>`);
    const first = hashOf("#\\:r1\\:");

    render(`<main><div><button id=":r7:">저장</button></div></main>`);
    const second = hashOf("#\\:r7\\:");

    expect(first).toBe(second);
  });

  it("콜론 없는 id 는 지문에 계속 반영된다", () => {
    render(`<main><div><button id="save">저장</button></div></main>`);
    const withId = hashOf("#save");

    render(`<main><div><button>저장</button></div></main>`);
    const withoutId = getElementMetadata(document.querySelector("button")!).elementSelectorHash;

    expect(withId).not.toBe(withoutId);
  });

  it("지문은 항상 16 hex 이고 계약을 통과한다", () => {
    render(`<main><div><button id="save">저장</button></div></main>`);
    const hash = hashOf("#save");

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(isSafeElementSelectorHash(hash)).toBe(true);
  });

  it("비정상적으로 긴 속성값이 지문을 통째로 지배하지 않는다", () => {
    const long = "x".repeat(500);
    render(`<main><div>
      <button name="${long}a">저장</button>
      <button name="${long}b">저장</button>
    </div></main>`);

    const [first, second] = Array.from(document.querySelectorAll("button"));
    // 64자에서 절단되므로 500자 뒤의 a/b 차이는 지문에 남지 않는다.
    expect(getElementMetadata(first!).elementSelectorHash).toBe(
      getElementMetadata(second!).elementSelectorHash,
    );
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/sdk -- dom.test.ts -t "요소 지문"`

Expected: FAIL. 예상 실패 내용 — "구조가 다른 버튼은 지문이 갈린다"·"id·role·속성이 없어도 조상 구조가 다르면 갈린다"·"안정 속성이 다르면 갈린다" 는 현재 선택자가 `button`/`input` 뿐이라 두 지문이 같아 `not.toBe` 가 깨진다. "콜론을 포함한 생성 id" 는 `#:r1:` 과 `#:r7:` 이 다른 문자열이라 깨진다. "지문은 항상 16 hex" 는 현재 `toString(16)` 이 패딩 없는 8자 이하를 내므로 깨진다. "비정상적으로 긴 속성값" 은 현재 속성을 아예 안 읽어 두 지문이 이미 같으므로 **통과한다** — 이 한 건은 절단 규칙의 회귀 고정용이고 기준 상태에서 실패하지 않는다는 것을 리포트에 적는다.

- [ ] **Step 3: `buildSelector` 를 구현한다**

`packages/sdk/src/dom.ts` 의 기존 `buildSelector` 를 아래로 교체하고, 상수 3개와 헬퍼 3개를 그 바로 위에 추가한다.

```ts
// 조상은 3단까지만 본다. 더 올라가면 페이지 껍데기가 지문을 지배해 판별력이 떨어지고,
// 얕으면 서로 다른 영역의 같은 컨트롤을 못 가른다.
const ANCESTOR_DEPTH = 3;
// 개발자가 쓴 값만 넣는다. 사용자 텍스트(aria-label·textContent)는 행마다 달라져
// 목록 행을 갈라 버리고, 클래스는 CSS 모듈·빌드 해시로 배포마다 바뀐다.
const STABLE_ATTRIBUTES = ["data-trace-id", "data-testid", "name", "type"] as const;
const ATTRIBUTE_VALUE_LIMIT = 64;

// React useId 는 `:r1:` 처럼 콜론을 포함한 id 를 렌더마다 새로 만든다. 그 id 를
// 지문에 넣으면 같은 버튼이 렌더마다 다른 요소로 갈려 이슈가 폭증한다.
// 콜론을 쓰지 않는 다른 생성기(무작위 UUID 등)는 이 가드가 잡지 못한다.
function stableId(element: Element): string {
  return element.id && !element.id.includes(":") ? `#${element.id}` : "";
}

function ancestorChain(element: Element): string {
  const root = element.ownerDocument.documentElement;
  const tags: string[] = [];
  let current = element.parentElement;

  for (let depth = 0; depth < ANCESTOR_DEPTH && current && current !== root; depth += 1) {
    tags.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }

  return tags.length === 0 ? "" : `${tags.join(">")}>`;
}

// 고정 순서로 이어 붙인다. 순서가 흔들리면 같은 요소가 다른 문자열을 만들어
// 지문이 불안정해진다.
function stableAttributes(element: Element): string {
  let attributes = "";

  for (const name of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    attributes += `[${name}="${value.slice(0, ATTRIBUTE_VALUE_LIMIT)}"]`;
  }

  return attributes;
}

function buildSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");

  return `${ancestorChain(element)}${tag}${stableId(element)}${stableAttributes(element)}${
    role ? `[role="${role}"]` : ""
  }`;
}
```

- [ ] **Step 4: 공유 해시 모듈을 만든다**

같은 64비트 접기를 SDK 와 서버가 모두 필요로 한다(서버는 Task 2 에서 `(지문, 글자)` 쌍을 접는다). 루프를 두 패키지에 통째로 복사하면 리뷰 기준으로 결함이고, 한쪽만 고쳐질 때 드리프트가 조용히 생긴다. `@trace/shared` 에 한 번만 둔다 — SDK 는 이미 `@trace/shared` 를 런타임으로 임포트하므로 번들 구조가 바뀌지 않는다.

`packages/shared/src/hash.ts` 를 새로 만든다.

```ts
// 32비트 누산기 두 개를 서로 다른 오프셋·소수로 돌려 16 hex 를 만든다. 입력이
// 다양해지면 서로 다른 입력이 같은 해시로 충돌할 확률이 오르고, 요소 지문에서
// 그 충돌은 서로 다른 컨트롤을 한 요소로 합치는 버그와 증상이 같다 — 32비트는
// 서로 다른 입력 약 77,000개에서 충돌 확률 50%다. 요소 지문 계약이 16 hex 까지
// 허용하므로 계약을 바꾸지 않고 폭을 두 배로 쓸 수 있다.
// BigInt 는 SDK 번들 예산 때문에 쓰지 않는다.
export function hash64Hex(input: string): string {
  let low = 0;
  let high = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    low = (low * 31 + code) >>> 0;
    // 16777619 를 평범하게 곱하면 2^53 을 넘어 정밀도를 잃는다. Math.imul 은
    // 32비트 곱을 정확히 낸다.
    high = Math.imul(high ^ code, 16777619) >>> 0;
  }

  return `${low.toString(16).padStart(8, "0")}${high.toString(16).padStart(8, "0")}`;
}
```

`packages/shared/src/index.ts` 에 재수출을 더한다. 기존 두 줄 아래에 추가한다.

```ts
export * from "./hash.js";
```

`packages/shared/src/hash.test.ts` 를 새로 만든다.

```ts
import { describe, expect, it } from "vitest";
import { hash64Hex } from "./hash.js";
import { isSafeElementSelectorHash } from "./privacy.js";

describe("hash64Hex", () => {
  it("항상 정확히 16 hex 를 낸다", () => {
    for (const input of ["", "a", "button", "body>main>form>button#save[type=\"submit\"]", "가".repeat(500)]) {
      expect(hash64Hex(input)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("요소 지문 계약을 통과한다", () => {
    expect(isSafeElementSelectorHash(hash64Hex("body>main>div>button"))).toBe(true);
  });

  it("같은 입력은 같은 값을, 다른 입력은 다른 값을 낸다", () => {
    expect(hash64Hex("body>main>form>button")).toBe(hash64Hex("body>main>form>button"));
    expect(hash64Hex("body>main>form>button")).not.toBe(hash64Hex("body>main>div>button"));
  });

  it("한 글자 차이도 반영한다", () => {
    expect(hash64Hex("button[name=\"a\"]")).not.toBe(hash64Hex("button[name=\"b\"]"));
  });
});
```

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/shared -- hash.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 4b: `hashSelector` 를 공유 함수에 위임한다**

`packages/sdk/src/dom.ts` 의 기존 `hashSelector` 함수를 **삭제**하고, 그 호출부를 공유 함수로 바꾼다. 파일 상단의 `@trace/shared` 임포트 목록에 `hash64Hex` 를 더한다(새 임포트 줄을 만들지 않는다).

`getElementMetadata` 안의 호출을 바꾼다:

```ts
    elementSelectorHash: hash64Hex(selector),
```

`hashSelector` 를 참조하는 다른 곳이 없는지 확인한다:

Run: `grep -rn "hashSelector" packages/sdk/src`

Expected: 결과 없음.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/sdk`

Expected: PASS. `dom.test.ts` 의 기존 테스트 중 지문 문자열을 고정값으로 단정한 것이 있으면 새 규칙에 맞게 갱신한다 — 단정을 약화시키지 말고 새 기대값으로 바꾼다.

- [ ] **Step 6: 번들 예산을 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build --workspace @trace/sdk && gzip -c packages/sdk/dist/trace.js | wc -c`

Expected: 10240 미만. 값을 리포트에 적는다(직전 기준 4854B).

- [ ] **Step 7: 커밋**

```bash
git add packages/shared/src/hash.ts packages/shared/src/hash.test.ts packages/shared/src/index.ts packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts
git commit -m "수정: 지문에 조상 구조와 안정 속성을 넣고 해시를 64비트로 넓힌다"
```

---

## Task 2: 서버 요소 신원 판정

**Files:**
- Create: `apps/api/src/detection/element-identity.ts`
- Create: `apps/api/src/detection/element-identity.test.ts`
- Modify: `apps/api/src/detection/detect.ts`
- Modify: `apps/api/src/detection/url.ts`
- Modify: `apps/api/src/detection/detect.test.ts`

**Interfaces:**
- Consumes: `TraceEvent` and `hash64Hex(input: string): string` from `@trace/shared` — `hash64Hex` 는 Task 1 이 만든다.
- Produces:
  - `export function sameElement(left: TraceEvent, right: TraceEvent): boolean`
  - `export function elementKey(event: TraceEvent): string | undefined` — 지문이 없으면 `undefined`, 있으면 16 hex
  - `issueTargetKey(input: { urlPath: string; elementKey?: string | undefined; issueType: string }): string` — 입력 필드명이 `selectorHash` 에서 `elementKey` 로 바뀐다

- [ ] **Step 1: 신원 모듈의 실패하는 테스트를 쓴다**

`apps/api/src/detection/element-identity.test.ts` 를 새로 만든다.

```ts
import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@trace/shared";
import { elementKey, sameElement } from "./element-identity.js";

function click(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    eventId: "evt_1",
    sessionId: "sess_1",
    pageId: "page_1",
    timestamp: "2026-09-03T01:00:00.000Z",
    type: "click",
    urlPath: "/settings",
    metadata: {},
    ...overrides,
  } as TraceEvent;
}

describe("sameElement", () => {
  it("지문과 글자가 모두 같으면 같은 요소다", () => {
    const left = click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "삭제" });
    const right = click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "삭제" });

    expect(sameElement(left, right)).toBe(true);
  });

  it("지문이 같고 글자가 다르면 다른 요소다", () => {
    const left = click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "리포트 내보내기" });
    const right = click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "오류 발생" });

    expect(sameElement(left, right)).toBe(false);
  });

  it("두 쪽 모두 글자가 없으면 같은 요소다", () => {
    const left = click({ elementSelectorHash: "aaaaaaaabbbbbbbb" });
    const right = click({ elementSelectorHash: "aaaaaaaabbbbbbbb" });

    expect(sameElement(left, right)).toBe(true);
  });

  it("한쪽만 글자가 있으면 다른 요소다", () => {
    const left = click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "삭제" });
    const right = click({ elementSelectorHash: "aaaaaaaabbbbbbbb" });

    expect(sameElement(left, right)).toBe(false);
  });
});

describe("elementKey", () => {
  it("지문이 없으면 키가 없다", () => {
    expect(elementKey(click({ type: "js_error" }))).toBeUndefined();
  });

  it("지문이 같고 글자가 다르면 서로 다른 16 hex 키를 낸다", () => {
    const first = elementKey(
      click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "리포트 내보내기" }),
    );
    const second = elementKey(
      click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "오류 발생" }),
    );

    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(second).toMatch(/^[0-9a-f]{16}$/);
    expect(first).not.toBe(second);
  });

  it("같은 쌍은 항상 같은 키를 낸다", () => {
    const event = click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "삭제" });

    expect(elementKey(event)).toBe(elementKey(event));
  });

  it("지문과 글자의 경계가 겹쳐도 키가 충돌하지 않는다", () => {
    // 구분자가 없으면 "ab" + "cd" 와 "abc" + "d" 가 같은 입력이 된다.
    const left = elementKey(click({ elementSelectorHash: "ab", elementTextMaskedOrLimited: "cd" }));
    const right = elementKey(click({ elementSelectorHash: "abc", elementTextMaskedOrLimited: "d" }));

    expect(left).not.toBe(right);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/api -- element-identity.test.ts`

Expected: FAIL — `Failed to resolve import "./element-identity.js"`.

- [ ] **Step 3: 신원 모듈을 구현한다**

`apps/api/src/detection/element-identity.ts` 를 새로 만든다. 해시는 Task 1 이 `@trace/shared` 에 만든 `hash64Hex` 를 쓴다 — 같은 루프를 여기 다시 쓰지 않는다.

```ts
import { hash64Hex, type TraceEvent } from "@trace/shared";

// 요소 신원은 지문만으로 정해지지 않는다. 구조와 속성이 완전히 같고 적힌 글자만
// 다른 컨트롤이 흔하다 — 같은 영역에 나란히 놓인 버튼들이 대표적이다. 그 글자는
// 이미 마스킹·절단되어 이벤트마다 저장되므로 새로 수집할 것이 없다.
export function sameElement(left: TraceEvent, right: TraceEvent): boolean {
  return (
    left.elementSelectorHash === right.elementSelectorHash &&
    left.elementTextMaskedOrLimited === right.elementTextMaskedOrLimited
  );
}

// 이슈 id 는 [^a-z0-9|:_-] 를 _ 로 치환한다(issueTargetKey). 한글 글자를 그대로
// 넣으면 "저장" 과 "오류 발생" 이 둘 다 "_" 가 되어 다시 합쳐지므로, 쌍을 hex 로
// 접어서 넣는다.
export function elementKey(event: TraceEvent): string | undefined {
  if (!event.elementSelectorHash) return undefined;

  // 구분자는 마스킹된 글자에 나타날 수 없는 NUL 이라, 두 필드의 경계가 겹쳐 서로
  // 다른 쌍이 같은 입력 문자열이 되는 일이 생기지 않는다.
  return hash64Hex(`${event.elementSelectorHash}\u0000${event.elementTextMaskedOrLimited ?? ""}`);
}
```

- [ ] **Step 4: 신원 모듈 테스트를 돌려 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/api -- element-identity.test.ts`

Expected: PASS (9 tests).

- [ ] **Step 5: 탐지기의 실패하는 테스트를 쓴다**

`apps/api/src/detection/detect.test.ts` 는 이미 5행에 `click(partial: Partial<TraceEvent>): TraceEvent` 헬퍼를 갖고 있다. **새 헬퍼를 만들지 말고 그 헬퍼를 고친다** — 지금은 `elementTextMaskedOrLimited: "권한 추가"` 를 하드코딩해 오버라이드를 받지 않아, 글자가 다른 클릭을 만들 수 없다. 그 한 줄만 바꾼다(기본값이 그대로이므로 기존 테스트는 영향받지 않는다):

```ts
    elementTextMaskedOrLimited: partial.elementTextMaskedOrLimited ?? "권한 추가",
```

그리고 파일 끝에 다음 describe 를 추가한다. `click` 과 `detectIssues` 는 이미 임포트돼 있다.

```ts
describe("요소 신원", () => {
  // 구조·속성이 같은 형제 버튼을 흉내낸다. SDK 는 이런 경우 같은 지문을 낸다.
  const SIBLING_HASH = "aaaaaaaabbbbbbbb";

  function siblingClick(eventId: string, timestamp: string, text: string): TraceEvent {
    return click({ eventId, timestamp, elementSelectorHash: SIBLING_HASH, elementTextMaskedOrLimited: text });
  }

  it("구조가 같고 글자만 다른 클릭은 분노 클릭으로 뭉치지 않는다", () => {
    // 서로 다른 두 버튼을 각각 2번. 어느 쪽도 3회 문턱을 넘지 않는다.
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-03T01:00:05.000Z",
      events: [
        siblingClick("evt_1", "2026-09-03T01:00:00.000Z", "리포트 내보내기"),
        siblingClick("evt_2", "2026-09-03T01:00:00.400Z", "오류 발생"),
        siblingClick("evt_3", "2026-09-03T01:00:00.800Z", "리포트 내보내기"),
        siblingClick("evt_4", "2026-09-03T01:00:01.200Z", "오류 발생"),
      ],
    });

    expect(issues.filter((issue) => issue.issueType === "rage_click")).toHaveLength(0);
  });

  it("글자까지 같은 클릭은 여전히 분노 클릭으로 잡는다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-03T01:00:05.000Z",
      events: [
        siblingClick("evt_1", "2026-09-03T01:00:00.000Z", "오류 발생"),
        siblingClick("evt_2", "2026-09-03T01:00:00.400Z", "오류 발생"),
        siblingClick("evt_3", "2026-09-03T01:00:00.800Z", "오류 발생"),
      ],
    });

    expect(issues.filter((issue) => issue.issueType === "rage_click")).toHaveLength(1);
  });

  it("한글 글자가 이슈 id 에서 뭉개지지 않는다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-03T01:00:30.000Z",
      events: [
        siblingClick("evt_1", "2026-09-03T01:00:00.000Z", "저장"),
        siblingClick("evt_2", "2026-09-03T01:00:10.000Z", "오류 발생"),
      ],
    });

    const deadClickIds = issues
      .filter((issue) => issue.issueType === "dead_click_cluster")
      .map((issue) => issue.issueId);

    expect(deadClickIds).toHaveLength(2);
    expect(new Set(deadClickIds).size).toBe(2);
  });

  it("오류 이슈의 id 는 여전히 page 슬롯을 쓴다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-03T01:00:05.000Z",
      events: [click({ eventId: "evt_err", type: "js_error", timestamp: "2026-09-03T01:00:00.000Z" })],
    });

    const error = issues.find((issue) => issue.issueType === "error_friction");
    expect(error?.issueId).toContain("|page|");
  });
});
```

**주의:** 마지막 테스트는 `click` 헬퍼로 `js_error` 이벤트를 만들므로 `elementSelectorHash` 가 `"button_hash"` 로 채워진다. 실제 오류 이벤트에는 지문이 없다. 이 테스트가 검증하려는 것은 "지문이 없을 때 page 슬롯을 쓴다" 가 아니라 "오류 이슈 id 형태가 이 변경으로 깨지지 않는다" 이므로, `elementSelectorHash: undefined` 를 명시해 실제 모양에 맞춘다:

```ts
      events: [
        click({
          eventId: "evt_err",
          type: "js_error",
          timestamp: "2026-09-03T01:00:00.000Z",
          elementSelectorHash: undefined,
        }),
      ],
```

`click` 헬퍼가 `partial.elementSelectorHash ?? "button_hash"` 이므로 `undefined` 를 넘겨도 기본값이 들어간다. 따라서 헬퍼를 고칠 때 이 필드도 함께 오버라이드 가능하게 만든다 — `"elementSelectorHash" in partial ? partial.elementSelectorHash : "button_hash"` 로 바꾸고, 위 테스트는 그대로 쓴다.

- [ ] **Step 6: 탐지기 테스트를 돌려 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/api -- detect.test.ts -t "요소 신원"`

Expected: FAIL. "구조가 같고 글자만 다른 클릭은 분노 클릭으로 뭉치지 않는다" 는 현재 지문만 비교해 4회 군집이 잡히므로 `toHaveLength(0)` 이 1 을 받아 깨진다. "한글 글자가 이슈 id 에서 뭉개지지 않는다" 는 두 이슈 id 가 같아 `toHaveLength(2)` 가 1 을 받아 깨진다. 나머지 두 건은 기준 상태에서도 통과한다 — 회귀 고정용이라는 것을 리포트에 적는다.

- [ ] **Step 7: `issueTargetKey` 의 입력 필드명을 바꾼다**

`apps/api/src/detection/url.ts` 를 아래로 교체한다. 동작은 그대로고 이름만 바뀐다 — `selectorHash` 라는 이름이 이제 지문이 아니라 `(지문, 글자)` 합성 키를 담기 때문이다.

```ts
export function issueTargetKey(input: { urlPath: string; elementKey?: string | undefined; issueType: string }): string {
  return [input.urlPath, input.elementKey ?? "page", input.issueType].join("|").replace(/[^a-z0-9|:_-]+/gi, "_");
}
```

- [ ] **Step 8: 탐지기를 신원 모듈에 연결한다**

`apps/api/src/detection/detect.ts` 를 다섯 군데 고친다.

임포트를 추가한다:

```ts
import { elementKey, sameElement } from "./element-identity.js";
```

`makeIssue` 의 입력 타입에서 필드명을 바꾼다 (`selectorHash?: string | undefined` → `elementKey?: string | undefined`), 그리고 `issueTargetKey` 호출을 맞춘다:

```ts
    issueId: `issue_${issueTargetKey({
      urlPath: input.relatedUrlPath,
      elementKey: input.elementKey,
      issueType: input.issueType,
    })}`,
```

`detectDeadClicks` 의 `makeIssue` 호출에서 (파일 기준 45행):

```ts
        elementKey: elementKey(event),
```

`detectRageClicks` 의 군집 비교에서 (파일 기준 61-68행) 지문 비교를 신원 비교로 바꾼다:

```ts
    const cluster = clicks.filter((event) => {
      const delta = Math.abs(Date.parse(event.timestamp) - Date.parse(current.timestamp));
      return event.sessionId === current.sessionId && sameElement(event, current) && delta <= 3000;
    });
```

그리고 같은 함수의 `makeIssue` 호출에서 (파일 기준 79행):

```ts
          elementKey: elementKey(current),
```

`detectLongPauses`(101행)와 `detectErrorFriction`(119행)의 `selectorHash: event.elementSelectorHash` 도 `elementKey: elementKey(event)` 로 바꾼다. 이 두 곳은 형태만 맞추는 기계적 변경이고 동작은 바뀌지 않는다 — SDK 는 요소 메타데이터를 클릭에만 싣고(`collectors.ts:84` 가 `getElementMetadata` 를 부르는 유일한 지점) idle 이벤트를 발행하지 않으므로, 두 함수가 보는 `elementSelectorHash` 는 항상 `undefined` 이고 키는 계속 `page` 다.

- [ ] **Step 9: API 테스트를 돌려 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/api`

Expected: PASS. 기존 `detect.test.ts` 테스트 중 이슈 id 문자열을 고정값으로 단정한 것이 있으면 새 키에 맞게 갱신한다 — `toContain("|page|")` 처럼 약화시키지 말고 새 기대값을 계산해 넣는다.

- [ ] **Step 10: 커밋**

```bash
git add apps/api/src/detection/element-identity.ts apps/api/src/detection/element-identity.test.ts apps/api/src/detection/detect.ts apps/api/src/detection/detect.test.ts apps/api/src/detection/url.ts
git commit -m "수정: 요소 신원을 지문과 마스킹 글자 쌍으로 판정한다"
```

---

## Task 3: 일회성 마이그레이션과 스토어 계약

**Files:**
- Modify: `apps/api/src/store/sqlite-store.ts`
- Modify: `apps/api/src/store/sqlite-store.test.ts`
- Modify: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: 없음 (스토어 내부)
- Produces: `SqliteStore` 생성 시 `PRAGMA user_version` 이 1 이상으로 올라간다. 공개 API 는 바뀌지 않는다.

- [ ] **Step 1: 실패하는 마이그레이션 테스트를 쓴다**

`apps/api/src/store/sqlite-store.test.ts` 에 새 describe 를 추가한다. 파일 상단에 이미 `import Database from "better-sqlite3";` 와 임시 DB 경로를 만드는 관례가 있으므로 그것을 따른다(기존 `it("migrates an existing events table to include received_at", ...)` 가 본보기다).

```ts
describe("SqliteStore 요소 신원 마이그레이션", () => {
  // 옛 규칙 데이터는 SqliteStore 를 처음 열기 전에 심어야 한다. SqliteStore 생성자가
  // migrate() 를 돌리므로, 먼저 열면 마이그레이션이 빈 DB 에서 소비된다.
  function seedLegacy(dbPath: string): void {
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        url_path TEXT NOT NULL,
        url_query_redacted TEXT,
        title_masked TEXT,
        element_selector_hash TEXT,
        element_role TEXT,
        element_text_masked_or_limited TEXT,
        x REAL,
        y REAL,
        viewport_x INTEGER,
        viewport_y INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE issues (
        issue_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        affected_sessions_count INTEGER NOT NULL,
        affected_users_count INTEGER NOT NULL,
        severity_score INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        trend TEXT NOT NULL,
        related_url_path TEXT,
        related_feature_id TEXT,
        example_session_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL
      );

      INSERT INTO events
        (event_id, project_id, session_id, page_id, timestamp, type, url_path, element_selector_hash, metadata)
      VALUES
        ('evt_old', 'proj_1', 'sess_1', 'page_1', '2026-09-01T00:00:00.000Z', 'click', '/settings', 'ade22732', '{}');

      INSERT INTO issues
        (issue_id, project_id, issue_type, title, summary, affected_sessions_count, affected_users_count,
         severity_score, first_seen_at, last_seen_at, trend, example_session_ids, status)
      VALUES
        ('issue__|ade22732|rage_click', 'proj_1', 'rage_click', '제목', '요약', 1, 1, 100,
         '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'flat', '[]', 'new'),
        ('issue__|page|error_friction', 'proj_1', 'error_friction', '제목', '요약', 1, 1, 71,
         '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'flat', '[]', 'new');
    `);
    legacy.close();
  }

  it("옛 지문을 무효화하고 해시로 키잉된 이슈만 지운다", () => {
    const dbPath = createTempDbPath();
    seedLegacy(dbPath);

    const store = new SqliteStore(dbPath);
    store.close();

    const migrated = new Database(dbPath, { readonly: true });
    try {
      const event = migrated
        .prepare("SELECT element_selector_hash FROM events WHERE event_id = ?")
        .get("evt_old") as Row;
      const issueIds = (migrated.prepare("SELECT issue_id FROM issues").all() as Row[]).map(
        (row) => row.issue_id as string,
      );
      const version = migrated.prepare("PRAGMA user_version").get() as Row;

      expect(event.element_selector_hash).toBeNull();
      expect(issueIds).toEqual(["issue__|page|error_friction"]);
      expect(version.user_version).toBe(1);
    } finally {
      migrated.close();
    }
  });

  it("두 번째 실행은 새 이벤트의 지문을 지우지 않는다", () => {
    const dbPath = createTempDbPath();
    seedLegacy(dbPath);

    const first = new SqliteStore(dbPath);
    first.close();

    const added = new Database(dbPath);
    added
      .prepare(
        `INSERT INTO events
           (event_id, project_id, session_id, page_id, timestamp, type, url_path, element_selector_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "evt_new",
        "proj_1",
        "sess_1",
        "page_1",
        "2026-09-03T00:00:00.000Z",
        "click",
        "/settings",
        "aaaaaaaabbbbbbbb",
        "{}",
      );
    added.close();

    const second = new SqliteStore(dbPath);
    second.close();

    const checked = new Database(dbPath, { readonly: true });
    try {
      const event = checked
        .prepare("SELECT element_selector_hash FROM events WHERE event_id = ?")
        .get("evt_new") as Row;

      expect(event.element_selector_hash).toBe("aaaaaaaabbbbbbbb");
    } finally {
      checked.close();
    }
  });
});
```

이 파일은 이미 `createTempDbPath()` 헬퍼와 `Row` 타입 별칭, `afterEach` 정리, `Database`·`SqliteStore` 임포트를 갖고 있다. 새로 만들지 말고 그대로 쓴다. 위 legacy 스키마는 기존 `it("migrates an existing events table to include received_at", ...)` 가 쓰는 방식과 같고, `issues` 테이블은 `related_error_signature` 컬럼을 일부러 빼서 컬럼 추가 마이그레이션도 함께 지나가게 한다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/api -- sqlite-store.test.ts -t "요소 신원 마이그레이션"`

Expected: FAIL. 첫 번째 테스트는 마이그레이션이 없어 `element_selector_hash` 가 `"ade22732"` 로 남고 이슈 두 건이 그대로 있어 깨진다. 두 번째 테스트는 **기준 상태에서 통과한다** — 가드가 빠졌을 때만 실패하는 회귀 고정용이라는 것을 리포트에 적는다. 두 번째 테스트만으로는 구현 여부를 변별할 수 없으므로 첫 번째와 짝으로만 의미가 있다.

- [ ] **Step 3: 마이그레이션을 구현한다**

`apps/api/src/store/sqlite-store.ts` 에 헬퍼를 추가한다. 기존 `hasColumn` 헬퍼 옆(파일 기준 37행 근처)에 둔다.

```ts
function userVersion(db: Database.Database): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}
```

그리고 `migrate()` 의 **맨 끝**에 다음을 추가한다. 컬럼 추가가 모두 끝난 뒤여야 `element_selector_hash` 가 존재한다.

```ts
    // 요소 지문 규칙이 바뀌었다. 과거 이벤트는 옛 규칙 지문을 들고 있고
    // detectIssues 는 배치마다 저장된 전체 이벤트에 대해 다시 도므로(ingestion.ts
    // 의 listEvents), 그대로 두면 옛 규칙 이슈가 영구히 재생성되어 같은 버튼을
    // 이중 집계한다. 이벤트 보존은 기본값이 없어 과거 이벤트가 만료되지도 않는다.
    //
    // 반복 실행되면 새 이벤트의 지문까지 지우므로 user_version 으로 한 번만 돌린다.
    // 기존 마이그레이션은 컬럼 추가형이라 버전 카운터를 쓰지 않았다.
    if (userVersion(this.db) < 1) {
      // 탐지기가 지문 없는 클릭을 이미 건너뛰므로 옛 규칙 이슈는 재생성되지 않는다.
      // 이슈 id 는 `issue_{urlPath}|{키 또는 page}|{타입}` 이고 urlPath 의 `/` 는 `_`
      // 로 치환되어 `|` 는 조립 구분자에서만 나온다. 따라서 `|page|` 는 지문 없는
      // 슬롯을 모호함 없이 식별한다 — 오류 이슈는 살아남는다.
      this.db.exec(`
        UPDATE events SET element_selector_hash = NULL;
        DELETE FROM issues WHERE issue_id NOT LIKE '%|page|%';
        PRAGMA user_version = 1;
      `);
    }
```

- [ ] **Step 4: 마이그레이션 테스트를 돌려 통과를 확인한다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/api -- sqlite-store.test.ts`

Expected: PASS.

- [ ] **Step 5: 스토어 계약 테스트를 추가한다**

`apps/api/src/store/store-contract.test.ts` 에, 두 스토어가 요소 신원의 두 입력을 모두 왕복 보존하는지 확인하는 테스트를 추가한다. 탐지기는 순수 함수라 스토어에 의존하지 않으므로, 계약에서 확인할 것은 "두 스토어가 탐지기에 같은 입력을 준다" 뿐이다. 파일이 두 스토어를 순회하는 기존 구조를 그대로 따른다.

```ts
  it("요소 지문과 마스킹 글자를 모두 왕복 보존한다", async () => {
    const store = createStore();
    await seedProjectAndSession(store);

    await store.saveBatch({
      projectId: "proj_1",
      url: "http://localhost:3000/settings",
      events: [
        {
          eventId: "evt_identity",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-03T01:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          elementSelectorHash: "aaaaaaaabbbbbbbb",
          elementTextMaskedOrLimited: "오류 발생",
          metadata: {},
        },
      ],
    } as never);

    const timeline = await store.getSessionTimeline("sess_1");
    const event = timeline.find((candidate) => candidate.eventId === "evt_identity");

    expect(event?.elementSelectorHash).toBe("aaaaaaaabbbbbbbb");
    expect(event?.elementTextMaskedOrLimited).toBe("오류 발생");
  });
```

`createStore`·`seedProjectAndSession`·`getSessionTimeline` 의 정확한 이름과 시그니처는 이 파일의 기존 테스트에서 그대로 가져온다. 위 이름이 파일과 다르면 파일의 것을 쓴다 — 새 헬퍼를 만들지 않는다.

- [ ] **Step 6: 전체 API 테스트를 돌린다**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test --workspace @trace/api`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/api/src/store/sqlite-store.ts apps/api/src/store/sqlite-store.test.ts apps/api/src/store/store-contract.test.ts
git commit -m "수정: 옛 요소 지문을 일회성으로 무효화한다"
```

---

## Task 4: 실수집 검증

**Files:**
- Modify: 검증 실패가 Tasks 1-3 이 만든 구체적 버그를 가리킬 때만.

**Interfaces:**
- Consumes: 앞선 모든 태스크
- Produces: 손으로 넣은 시드가 아니라 실제 브라우저 클릭에서 네 버튼이 네 요소로 갈리고 허위 분노 클릭이 생기지 않는다는 증거

이 태스크가 시드가 아니라 실수집을 요구하는 이유: 이 결함이 지금까지 안 걸린 원인이 정확히 **시드 데이터가 해시를 손으로 다르게 넣었기 때문**이다. 같은 함정을 반복하지 않는다.

- [ ] **Step 1: 전체 스위트·타입·빌드**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`
Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck`
Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build`

Expected: 모두 PASS. 기준선은 575 테스트 + 이 계획이 추가한 것.

- [ ] **Step 2: 번들 크기 보고**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH gzip -c packages/sdk/dist/trace.js | wc -c`

Expected: 10240 미만. 직전 기준 4854B. 예산을 넘으면 멈추고 보고한다.

- [ ] **Step 3: 데모 사이트로 실제 수집**

사용자 서버(:4000, :5173)와 충돌하지 않게 별도 포트를 쓴다. API 는 **워크트리 기준으로** 띄운다 — cwd 가 메인 체크아웃이면 이 브랜치 코드가 아닌 것이 돌아간다. 띄운 뒤 `lsof -a -p <pid> -d cwd` 로 cwd 를 확인한다. 이 확인을 빠뜨려 이전 단계에서 거짓 판독이 한 번 나왔다.

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH NODE_ENV=development PORT=4100 \
  TRACE_DB_PATH=/private/tmp/trace-identity.db GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy \
  GOOGLE_REDIRECT_URI=http://localhost:4100/auth/google/callback \
  SESSION_SECRET=0123456789abcdef0123456789abcdef ADMIN_APP_ORIGIN=http://localhost:5174 \
  ADMIN_ALLOWED_EMAILS=admin@example.com COOKIE_SECURE=false LOCAL_ADMIN_LOGIN=true npm run dev:api
```

관리자는 `npm run dev:admin -- --port 5174` 로 띄우면 npm workspace 가 인자를 vite 위치인자로 흘려 5173 에 뜬다. `apps/admin` 에서 `npx vite --port 5174 --strictPort` 로 직접 띄운다. 데모는 `npm run dev:demo -- --port 5175 --strictPort`.

`/auth/local/start` 로 세션 쿠키를 받고(CSRF 헤더 이름은 `x-trace-csrf`), 프로젝트를 만들 때 `allowedDomains` 에 `http://localhost:5175` 를 넣는다. 데모를 `?projectId=<id>&port=4100` 으로 열고, **실제로 클릭한다**: `저장` 1회, `권한 추가` 1회, `리포트 내보내기` 2회, `오류 발생` 2회. SDK 배치가 나갈 시간을 준 뒤(10초 이상) 페이지를 떠나지 않는다.

- [ ] **Step 4: 수집 결과 확인**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH node -e '
const db = require("better-sqlite3")("/private/tmp/trace-identity.db", {readonly:true});
const rows = db.prepare("SELECT element_text_masked_or_limited t, element_selector_hash h FROM events WHERE type = ?").all("click");
for (const row of rows) console.log(JSON.stringify(row.t), row.h);
console.log("서로 다른 지문 수:", new Set(rows.map(r => r.h)).size);
console.log("이슈:", JSON.stringify(db.prepare("SELECT issue_type, summary FROM issues").all()));
'
```

Expected: 지문이 모두 16 hex 다. `저장` 은 `<form>` 안이라 다른 세 개와 지문이 다르다. `권한 추가` 는 id 가 있어 다르다. `리포트 내보내기` 와 `오류 발생` 은 구조가 같아 **지문이 같을 수 있다** — 그건 정상이며, 이 둘은 글자로 갈린다. 그리고 **`rage_click` 이슈가 없다.** 있으면 그 `summary` 의 클릭 횟수를 보고, 서로 다른 버튼이 합산됐는지 확인한다.

- [ ] **Step 5: 화면 확인**

관리자(`:5174`)에서 데모 프로젝트를 선택한다. 확인할 것: 반응 없는 클릭 이슈가 버튼별로 갈려 있다(한 건으로 뭉쳐 있지 않다). 스크린샷을 남겨 리포트에 경로를 적는다.

- [ ] **Step 6: 정리**

띄운 서버를 종료하고(사용자의 :4000/:5173 은 건드리지 않는다) 임시 DB 를 지운다.

```bash
rm -f /private/tmp/trace-identity.db
```

- [ ] **Step 7: git 정합성 확인**

Run: `git status --short`

Expected: 이 기능의 파일만 변경돼 있다. 무관한 사용자 변경은 그대로 둔다.

- [ ] **Step 8: 검증 수정이 있었으면 커밋**

Step 1-7 이 코드 변경을 요구했으면 그 파일만 커밋한다. 없으면 빈 커밋을 만들지 않는다.

```bash
git add <정확히 변경한 파일>
git commit -m "수정: 요소 신원 검증 이슈 정리"
```

---

## Self-Review

**Spec 커버리지**

| Spec 항목 | 태스크 |
|---|---|
| 조상 태그 체인 최대 3단 | Task 1 Step 3 |
| 안정 속성 고정 순서 + 64자 절단 | Task 1 Step 3 |
| `:` 포함 id 건너뛰기 | Task 1 Step 3 |
| 해시 64비트 / 16 hex / 계약 무변경 | Task 1 Step 4 |
| `(지문, 글자)` 쌍 동등 비교 | Task 2 Step 3, Step 8 |
| 이슈 키를 hex 로 접기 (한글 뭉개짐 방지) | Task 2 Step 3, Step 5 |
| `detectDeadClicks`·`detectRageClicks` 실제 변경 | Task 2 Step 8 |
| `detectLongPauses`·`detectErrorFriction` 기계적 변경 | Task 2 Step 8 |
| 오류 이슈 id 유지 (`page` 슬롯) | Task 2 Step 5 |
| `user_version` 가드 일회성 마이그레이션 | Task 3 Step 3 |
| 해시 키 이슈만 삭제, 오류 이슈 보존 | Task 3 Step 1, Step 3 |
| 두 스토어 동일 입력 보장 | Task 3 Step 5 |
| 실수집 성공 기준 | Task 4 |
| 남는 한계 3가지 | 코드 변경 없음 — Task 1 Step 3 주석에 기록 |

**Placeholder 스캔:** 모든 코드 스텝에 실제 코드가 있다. Task 3 Step 1·Step 5 는 기존 파일의 헬퍼 이름을 그대로 쓰라고 지시하며(추측한 이름이 다를 경우의 처리를 명시), Task 4 Step 8 은 조건부 커밋이다. Task 4 의 Files 는 조건부이며 스펙의 검증 전용 성격과 일치한다.

**타입 일관성:** `sameElement(left, right): boolean`·`elementKey(event): string | undefined`(Task 2 에서 정의 → 같은 태스크에서 소비), `issueTargetKey` 의 `elementKey` 필드(Task 2 Step 7 정의 → Step 8 에서 `makeIssue` 가 소비), `userVersion(db): number`(Task 3 Step 3 정의 → 같은 스텝에서 소비)가 정의 전에 쓰이지 않는다. `buildSelector`·`hashSelector` 는 export 하지 않으므로 태스크 경계를 넘지 않는다.

**주의:** Task 1 Step 5 와 Task 2 Step 9 는 각각 기존 테스트가 지문·이슈 id 고정값을 단정하고 있을 가능성을 다룬다. 두 곳 모두 "단정을 약화시키지 말고 새 기대값으로 갱신" 을 명시했다 — 이 계획의 이력에서 반복된 결함이 실패할 수 없는 테스트이므로, 갱신을 `toBeDefined()` 류로 뭉개지 않는다.

**기준 상태에서 실패하지 않는 테스트 3건(의도적):** Task 1 의 "비정상적으로 긴 속성값", Task 2 의 "글자까지 같은 클릭은 여전히 분노 클릭으로 잡는다"·"오류 이슈의 id 는 여전히 page 슬롯을 쓴다", Task 3 의 "두 번째 실행은 새 이벤트의 지문을 지우지 않는다". 모두 회귀 고정용이며 각 스텝의 Expected 에 그렇게 적혀 있다. 구현 여부를 변별하는 테스트와 짝으로만 의미가 있다.
