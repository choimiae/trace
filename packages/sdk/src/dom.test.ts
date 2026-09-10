import { isSafeElementSelectorHash, screenContextSchema } from "@trace/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getElementMetadata, getScreenContext, isPaintedBox, scanBoxes } from "./dom.js";

// 이전 테스트가 남긴 DOM 이 다음 테스트로 새면 rect 가 우연히 0으로 겹치는 등
// 재현 불가능한 통과/실패가 생긴다. 매 테스트를 빈 body 에서 시작한다.
beforeEach(() => {
  document.body.innerHTML = "";
  // title 도 비운다. body 와 달리 jsdom 이 자동으로 되돌리지 않아, 한 테스트가
  // 설정한 제목이 이후 모든 테스트의 screenContext 에 실린다.
  document.title = "";
});

function stubRect(
  element: Element,
  rect: { x: number; y: number; width: number; height: number },
): void {
  element.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => ({}),
  }));
}

function stubStyle(element: Element, style: Partial<CSSStyleDeclaration>): void {
  const view = element.ownerDocument.defaultView!;
  const original = view.getComputedStyle.bind(view);
  vi.spyOn(view, "getComputedStyle").mockImplementation((target: Element, pseudo?: string | null) => {
    if (target !== element) return original(target, pseudo ?? undefined);
    return { ...original(target, pseudo ?? undefined), ...style } as CSSStyleDeclaration;
  });
}

// stubStyle 은 getComputedStyle 에 스파이를 건다. 복원하지 않으면 다음 테스트가
// 이전 목 위에 또 목을 쌓아, mockRestore 가 원본이 아니라 이전 목으로 되돌린다.
afterEach(() => {
  vi.restoreAllMocks();
});

// 생산자(SDK)가 만든 값은 소비자(수집 API)의 screenContextSchema 를 항상 통과해야 한다.
// 통과하지 못하면 배치 전체가 400 이 되고 SDK 큐가 영구히 막힌다.
function expectValidScreenContext(element: Element) {
  const context = getScreenContext(element);
  expect(context).toBeDefined();
  const parsed = screenContextSchema.safeParse(context);
  expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  return context!;
}

describe("getElementMetadata", () => {
  it("returns safe button metadata", () => {
    document.body.innerHTML = `<button id="invite">멤버 초대</button>`;
    const button = document.querySelector("button")!;

    expect(getElementMetadata(button)).toMatchObject({
      elementRole: "button",
      elementTextMaskedOrLimited: "멤버 초대",
    });
  });

  it("does not expose input values", () => {
    document.body.innerHTML = `<input id="email" type="email" value="choi@example.com" />`;
    const input = document.querySelector("input")!;

    expect(getElementMetadata(input).elementTextMaskedOrLimited).toBeUndefined();
  });

  it("자손에 contenteditable 이 있으면 그 요소의 텍스트를 담지 않는다", () => {
    // textContent 는 자손을 포함한다. isTextEntryElement 는 요소 자신과 조상만
    // 보므로, 화이트리스트 요소 안에 편집 가능 자손이 있으면 그 안의 글자가
    // textContent 를 통해 새어 나간다.
    document.body.innerHTML = `<h1>고객 상세 <span contenteditable="true">김철수 010-1111-2222 메모</span></h1>`;
    const heading = document.querySelector("h1")!;

    expect(getElementMetadata(heading).elementTextMaskedOrLimited).toBeUndefined();
  });

  it("자손에 textarea 가 있으면 그 요소의 텍스트를 담지 않는다", () => {
    document.body.innerHTML = `<a href="/x"><span>행 열기</span><textarea>서울시 성동구 어딘가</textarea></a>`;
    const link = document.querySelector("a")!;

    expect(getElementMetadata(link).elementTextMaskedOrLimited).toBeUndefined();
  });
});

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

  // 안정 속성은 하나씩 못박는다. 두 속성을 동시에 바꾸는 테스트 하나로는 둘 중
  // 어느 쪽을 STABLE_ATTRIBUTES 에서 지워도 여전히 통과한다.
  it("data-trace-id 만 달라도 갈린다", () => {
    render(`
      <main><div>
        <button data-trace-id="settings-save">저장</button>
        <button data-trace-id="settings-cancel">저장</button>
      </div></main>
    `);

    const [save, cancel] = Array.from(document.querySelectorAll("button"));
    expect(getElementMetadata(save!).elementSelectorHash).not.toBe(
      getElementMetadata(cancel!).elementSelectorHash,
    );
  });

  it("data-testid 만 달라도 갈린다", () => {
    render(`
      <main><div>
        <button data-testid="save-button">저장</button>
        <button data-testid="cancel-button">저장</button>
      </div></main>
    `);

    const [save, cancel] = Array.from(document.querySelectorAll("button"));
    expect(getElementMetadata(save!).elementSelectorHash).not.toBe(
      getElementMetadata(cancel!).elementSelectorHash,
    );
  });

  it("name 만 달라도 갈린다", () => {
    render(`
      <main><div>
        <input type="text" name="workspaceName" />
        <input type="text" name="ownerName" />
      </div></main>
    `);

    const [workspace, owner] = Array.from(document.querySelectorAll("input"));
    expect(getElementMetadata(workspace!).elementSelectorHash).not.toBe(
      getElementMetadata(owner!).elementSelectorHash,
    );
  });

  it("type 만 달라도 갈린다", () => {
    render(`
      <main><div>
        <input type="text" name="owner" />
        <input type="email" name="owner" />
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

  // 다음 두 테스트가 ANCESTOR_DEPTH 를 정확히 3 에 못박는다. 하나만 있으면 깊이를
  // 1 로 줄이거나 10 으로 늘려도 전부 통과한다. 10 은 spec 위반이다 — 페이지
  // 껍데기(body>main>...)가 지문을 지배해 판별력이 떨어진다.
  it("조상 4단에서만 다른 두 요소는 지문을 공유한다", () => {
    render(`
      <main><div><section><span><button class="in-main">저장</button></span></section></div></main>
      <aside><div><section><span><button class="in-aside">저장</button></span></section></div></aside>
    `);

    // 조상 사슬은 양쪽 모두 div>section>span 이고, main/aside 는 4단이라 밖이다.
    expect(hashOf(".in-main")).toBe(hashOf(".in-aside"));
  });

  it("조상 3단에서 다른 두 요소는 지문이 갈린다", () => {
    render(`
      <main><div><span><button class="in-main">저장</button></span></div></main>
      <aside><div><span><button class="in-aside">저장</button></span></div></aside>
    `);

    // 조상 사슬이 main>div>span 과 aside>div>span 으로 갈린다.
    expect(hashOf(".in-main")).not.toBe(hashOf(".in-aside"));
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

describe("getScreenContext", () => {
  it("captures viewport and target rect for safe clickable elements", () => {
    document.title = "설정";
    window.innerWidth = 1440;
    window.innerHeight = 900;
    const button = document.createElement("button");
    button.textContent = "저장";
    button.getBoundingClientRect = vi.fn(() => ({
      x: 620,
      y: 420,
      width: 96,
      height: 40,
      top: 420,
      left: 620,
      right: 716,
      bottom: 460,
      toJSON: () => ({}),
    }));
    document.body.appendChild(button);

    const context = getScreenContext(button);

    expect(context).toEqual({
      viewport: { width: 1440, height: 900 },
      titleMasked: "설정",
      target: {
        tagName: "button",
        role: "button",
        textMaskedOrLimited: "저장",
        selectorHash: expect.any(String),
        rect: { x: 620, y: 420, width: 96, height: 40 },
      },
      layoutHints: [],
    });
  });

  it("omits text for sensitive input targets", () => {
    window.innerWidth = 390;
    window.innerHeight = 844;
    const input = document.createElement("input");
    input.type = "email";
    input.name = "email";
    input.value = "user@example.com";
    input.getBoundingClientRect = vi.fn(() => ({
      x: 16,
      y: 120,
      width: 260,
      height: 44,
      top: 120,
      left: 16,
      right: 276,
      bottom: 164,
      toJSON: () => ({}),
    }));

    const context = getScreenContext(input);

    expect(context?.target).toMatchObject({
      tagName: "input",
      role: "input",
      rect: { x: 16, y: 120, width: 260, height: 44 },
    });
    expect(context?.target).not.toHaveProperty("textMaskedOrLimited");
  });

  it("returns undefined when browser APIs throw", () => {
    const button = document.createElement("button");
    button.getBoundingClientRect = vi.fn(() => {
      throw new Error("layout unavailable");
    });

    expect(getScreenContext(button)).toBeUndefined();
  });

  it("omits text for textarea targets", () => {
    document.body.innerHTML = `<textarea name="address">서울시 성동구 어딘가 123-45</textarea>`;
    const textarea = document.querySelector("textarea")!;
    stubRect(textarea, { x: 16, y: 200, width: 320, height: 120 });

    const context = getScreenContext(textarea);

    expect(context?.target).toMatchObject({ tagName: "textarea" });
    expect(context?.target).not.toHaveProperty("textMaskedOrLimited");
  });

  it("omits text for contenteditable targets", () => {
    document.body.innerHTML = `<div contenteditable="true">고객 메모: 최미애 010-1234-5678</div>`;
    const editable = document.querySelector("div")!;
    stubRect(editable, { x: 16, y: 200, width: 320, height: 120 });

    const context = getScreenContext(editable);

    expect(context?.target).toMatchObject({ tagName: "div" });
    expect(context?.target).not.toHaveProperty("textMaskedOrLimited");
  });

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
    // section 은 문서 전체 geometry 스캔으로 이제 수집된다(자기 텍스트 노드가
    // 있어 칠해짐 판정을 통과한다) — 그러나 TEXT_TAG_WHITELIST 에 없어 텍스트는
    // 여전히 담기지 않는다. 컨테이너는 상자로만 보이고 글자는 새지 않는다.
    expect(byTag("section")).toBeDefined();
    expect(byTag("section")).not.toHaveProperty("textMaskedOrLimited");
    expect(JSON.stringify(context)).not.toContain("박스 안의 긴 설명 문구");
  });

  it("텍스트를 담지 않는 랜드마크에서는 textContent 를 아예 읽지 않는다", () => {
    // <main> 의 textContent 는 화면 전체 문자열이고, redactText 는 그 위로 전역
    // 정규식 3개를 돌린다. allowsHintText 가 어차피 버릴 문자열을 고객 사이트의
    // 클릭 핸들러 안에서 만들어 내면 안 된다 — 업무 그리드에서 밀리초 단위 비용이
    // 힌트 12개 × rage click 연타만큼 곱해진다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `
      <main id="page">
        <button id="save">저장</button>
        <button id="go">결제하기</button>
      </main>
    `;
    const landmark = document.querySelector("#page")!;
    stubRect(landmark, { x: 0, y: 0, width: 1440, height: 900 });
    stubRect(document.querySelector("#save")!, { x: 20, y: 260, width: 120, height: 40 });
    stubRect(document.querySelector("#go")!, { x: 20, y: 320, width: 120, height: 40 });
    let landmarkTextReads = 0;
    Object.defineProperty(landmark, "textContent", {
      configurable: true,
      get: () => {
        landmarkTextReads += 1;
        return "저장 결제하기";
      },
    });

    const context = expectValidScreenContext(document.querySelector("#go")!);
    const byTag = (tagName: string) => context.layoutHints.find((hint) => hint.tagName === tagName);

    expect(landmarkTextReads).toBe(0);
    // 이웃 버튼은 여전히 텍스트를 담는다 — 건너뛴 것이 "전부"가 아님을 함께 고정한다.
    expect(byTag("main")).toBeDefined();
    expect(byTag("button")?.textMaskedOrLimited).toBe("저장");
  });

  it("뷰포트 밖(아래·위·왼쪽) 요소나 0크기 요소는 힌트에서 제외하고 안의 이웃은 담는다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `
      <main id="page">
        <button id="below">아래쪽</button>
        <button id="above">위쪽</button>
        <button id="left">왼쪽</button>
        <button id="zero">제로</button>
        <button id="near">가까운 버튼</button>
        <button id="go">저장</button>
      </main>
    `;
    stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
    stubRect(document.querySelector("#below")!, { x: 0, y: 5000, width: 100, height: 40 });
    // rectFromDomRect 는 음수 좌표를 0 으로 클램프한다. intersectsViewport 가
    // 클램프 뒤 값을 보면 위/왼쪽으로 완전히 스크롤된 요소가 y:0·x:0 으로 접혀
    // 뷰포트 안으로 잘못 판정된다 — 원시 DOMRect 로 판정해야 걸러진다.
    stubRect(document.querySelector("#above")!, { x: 0, y: -800, width: 100, height: 40 });
    stubRect(document.querySelector("#left")!, { x: -500, y: 20, width: 100, height: 40 });
    // 뷰포트 안 양의 좌표라도 너비·높이가 0이면 화면에 보이지 않는다 — 슬롯을
    // 낭비하면 안 된다.
    stubRect(document.querySelector("#zero")!, { x: 10, y: 40, width: 0, height: 0 });
    stubRect(document.querySelector("#near")!, { x: 10, y: 60, width: 96, height: 40 });
    stubRect(document.querySelector("#go")!, { x: 10, y: 20, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#go")!);
    const texts = context.layoutHints.map((hint) => hint.textMaskedOrLimited);

    expect(texts).not.toContain("아래쪽");
    expect(texts).not.toContain("위쪽");
    expect(texts).not.toContain("왼쪽");
    expect(texts).not.toContain("제로");
    // 부재만 확인하면 layoutHints 가 통째로 [] 여도 통과한다 — 실제 이웃이
    // 담기는지까지 확인해야 생산자가 살아있다는 증거가 된다.
    expect(texts).toContain("가까운 버튼");
  });

  it("후보가 많아도 힌트는 정확히 50개로 잘린다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    const buttons = Array.from({ length: 80 }, (_unused, index) => `<button id="b${index}">버튼${index}</button>`).join("");
    document.body.innerHTML = `<main id="page">${buttons}<button id="go">저장</button></main>`;
    stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
    // 8px 씩 벌린다. 1px 간격이면 근사 중복 판정이 4px 미만 무리마다 대표 하나만
    // 남겨, 이 테스트가 재는 것이 "상한 20" 이 아니라 "중복 제거가 남기는 대표
    // 개수" 가 된다 — 1px×80개에서는 그 대표 수가 마침 20이라 통과하지만 상한
    // 때문이 아니다. 인덱스 79 도 x=632·y=632 라 1440×900 안에 있다.
    for (let index = 0; index < 80; index += 1) {
      stubRect(document.querySelector(`#b${index}`)!, { x: index * 8, y: index * 8, width: 40, height: 20 });
    }
    stubRect(document.querySelector("#go")!, { x: 10, y: 10, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#go")!);

    // 80개의 버튼 + main 랜드마크가 모두 뷰포트 안에 있으므로 개수는 상한
    // 50으로 결정적이다. <= 50 만 보면 생산자가 조용히 힌트를 덜 채워도 통과한다.
    expect(context.layoutHints.length).toBe(50);
  });

  it("랜드마크가 없는 문서에서도 안전하게 동작한다", () => {
    // 이 문서의 유일한 후보는 타겟 자신(제외 대상)뿐이라 결과는 항상 [] 다.
    // 이 테스트는 값을 검증하는 게 아니라 죽지 않는다는 것만 확인한다.
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
    // 부재(not.toContain)만으로는 layoutHints 가 통째로 비어도 통과한다.
    // 힌트가 실제로 담기고, masked:true 이며, 텍스트 필드 자체가 없는지까지 본다.
    const inner = context.layoutHints.find((hint) => hint.tagName === "button");

    expect(inner).toBeDefined();
    expect(inner?.masked).toBe(true);
    expect(inner).not.toHaveProperty("textMaskedOrLimited");
    expect(JSON.stringify(context)).not.toContain("김철수");
  });

  it("비밀번호 입력은 마스킹하고 텍스트를 담지 않는다", () => {
    // isTextEntryElement 는 textarea·contenteditable 만 잡고 input 은 잡지
    // 않는다. masked 를 그것만으로 계산하면 password 입력조차 masked:false 가
    // 되어 미리보기가 평범한 박스로 그려진다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `
      <main id="page">
        <input id="pw" type="password" value="secret" />
        <button id="go">로그인</button>
      </main>
    `;
    stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
    stubRect(document.querySelector("#pw")!, { x: 20, y: 20, width: 200, height: 40 });
    stubRect(document.querySelector("#go")!, { x: 20, y: 80, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#go")!);
    const password = context.layoutHints.find((hint) => hint.tagName === "input");

    expect(password?.masked).toBe(true);
    expect(password).not.toHaveProperty("textMaskedOrLimited");
  });

  it("문서 앞쪽 크롬이 많아도 타겟과 가까운 이웃을 후보에서 놓치지 않는다", () => {
    // 이전 구현은 이웃 후보를 문서 순서로 60개 자른 뒤 거리로 정렬했다.
    // nearestContainer 가 body 로 폴백하면 문서 앞쪽 크롬이 60칸을 다 먹어
    // 정작 타겟의 실제 이웃(형제)은 후보에도 들지 못했다. 타겟은 4단 중첩된
    // div 안에 있어 nearestContainer 가 CONTAINER_SELECTOR 를 못 찾고 body 로
    // 폴백한다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    const chrome = Array.from({ length: 70 }, (_unused, index) => `<button id="chrome${index}">크롬${index}</button>`).join(
      "",
    );
    document.body.innerHTML = `
      ${chrome}
      <div><div><div><div>
        <button id="sibling-before">이전 버튼</button>
        <button id="go">저장</button>
        <button id="sibling-after">다음 버튼</button>
      </div></div></div></div>
    `;
    for (let index = 0; index < 70; index += 1) {
      stubRect(document.querySelector(`#chrome${index}`)!, { x: index, y: 0, width: 40, height: 20 });
    }
    stubRect(document.querySelector("#sibling-before")!, { x: 10, y: 760, width: 96, height: 40 });
    stubRect(document.querySelector("#go")!, { x: 10, y: 810, width: 96, height: 40 });
    stubRect(document.querySelector("#sibling-after")!, { x: 10, y: 860, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#go")!);
    const texts = context.layoutHints.map((hint) => hint.textMaskedOrLimited);

    expect(texts).toContain("이전 버튼");
    expect(texts).toContain("다음 버튼");
  });

  it("클릭이 버튼 안 아이콘에 떨어져도 크롬이 아닌 실제 이웃이 이긴다", () => {
    // 클릭은 실무에서 버튼 안 아이콘·span 에 자주 떨어진다. 그 요소는
    // NEIGHBOR_SELECTOR 에 없어 all.indexOf(target) 이 -1 이 되고, anchor 가
    // 0 으로 붕괴하면 창이 문서 맨 앞으로 밀려 페이지 크롬이 12칸을 다 먹는다.
    // target.closest(NEIGHBOR_SELECTOR) 로 가장 가까운 후보를 앵커로 써야 한다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    const chrome = Array.from({ length: 70 }, (_unused, index) => `<button id="chrome${index}">크롬${index}</button>`).join(
      "",
    );
    document.body.innerHTML = `
      ${chrome}
      <div><div><div><div>
        <button id="sibling-before">이전 버튼</button>
        <button id="go"><span id="label">저장</span></button>
        <button id="sibling-after">다음 버튼</button>
      </div></div></div></div>
    `;
    for (let index = 0; index < 70; index += 1) {
      stubRect(document.querySelector(`#chrome${index}`)!, { x: index, y: 0, width: 40, height: 20 });
    }
    stubRect(document.querySelector("#sibling-before")!, { x: 10, y: 760, width: 96, height: 40 });
    stubRect(document.querySelector("#go")!, { x: 10, y: 810, width: 96, height: 40 });
    stubRect(document.querySelector("#label")!, { x: 20, y: 815, width: 60, height: 20 });
    stubRect(document.querySelector("#sibling-after")!, { x: 10, y: 860, width: 96, height: 40 });

    // 타겟은 span 자신 — 실제 클릭 요소는 버튼이 아니라 그 안의 아이콘/라벨이다.
    const context = expectValidScreenContext(document.querySelector("#label")!);
    const texts = context.layoutHints.map((hint) => hint.textMaskedOrLimited);

    expect(context.target?.tagName).toBe("span");
    expect(texts).toContain("이전 버튼");
    expect(texts).toContain("다음 버튼");
  });

  it("상호작용 조상이 컨테이너 밖에 있어도 이웃 창이 붕괴하지 않는다", () => {
    // closest(NEIGHBOR_SELECTOR) 로 찾은 상호작용 조상이 nearestContainer 범위
    // 밖에 있으면(여기선 section 을 감싸는 바깥 <a>) all 에 없어 indexOf 가
    // 다시 -1 이 된다. 문서 위치 기준 삽입점(compareDocumentPosition)을 써야
    // target 이 all 에 있든 없든 항상 타겟 주변이 잡힌다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    const fillers = Array.from(
      { length: 70 },
      (_unused, index) => `<button id="filler${index}">필러${index}</button>`,
    ).join("");
    document.body.innerHTML = `
      <a href="/x">
        <section id="section">
          ${fillers}
          <button id="sibling-before">이전</button>
          <div><span id="label"></span></div>
          <button id="sibling-after">다음</button>
        </section>
      </a>
    `;
    for (let index = 0; index < 70; index += 1) {
      stubRect(document.querySelector(`#filler${index}`)!, { x: index, y: 0, width: 40, height: 20 });
    }
    stubRect(document.querySelector("#sibling-before")!, { x: 10, y: 760, width: 96, height: 40 });
    stubRect(document.querySelector("#label")!, { x: 10, y: 810, width: 60, height: 20 });
    stubRect(document.querySelector("#sibling-after")!, { x: 10, y: 860, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#label")!);
    const texts = context.layoutHints.map((hint) => hint.textMaskedOrLimited);

    expect(texts).toContain("이전");
    expect(texts).toContain("다음");
  });

  it("상호작용 조상이 아예 없는 클릭(맨 div)도 이웃 창이 붕괴하지 않는다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    const fillers = Array.from(
      { length: 70 },
      (_unused, index) => `<button id="filler${index}">필러${index}</button>`,
    ).join("");
    document.body.innerHTML = `
      <main id="page">
        ${fillers}
        <button id="sibling-before">이전</button>
        <div id="plain">평범한 영역</div>
        <button id="sibling-after">다음</button>
      </main>
    `;
    stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
    for (let index = 0; index < 70; index += 1) {
      stubRect(document.querySelector(`#filler${index}`)!, { x: index, y: 0, width: 40, height: 20 });
    }
    stubRect(document.querySelector("#sibling-before")!, { x: 10, y: 760, width: 96, height: 40 });
    stubRect(document.querySelector("#plain")!, { x: 10, y: 810, width: 200, height: 40 });
    stubRect(document.querySelector("#sibling-after")!, { x: 10, y: 860, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#plain")!);
    const texts = context.layoutHints.map((hint) => hint.textMaskedOrLimited);

    expect(texts).toContain("이전");
    expect(texts).toContain("다음");
  });

  it("이웃 하나의 rect 조회가 던져도 화면 맥락 전체를 잃지 않는다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `
      <main id="page">
        <button id="broken">깨진 버튼</button>
        <button id="go">저장</button>
      </main>
    `;
    stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
    document.querySelector("#broken")!.getBoundingClientRect = vi.fn(() => {
      throw new Error("layout unavailable");
    });
    stubRect(document.querySelector("#go")!, { x: 10, y: 20, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#go")!);

    expect(context.viewport).toEqual({ width: 1440, height: 900 });
    expect(context.target?.tagName).toBe("button");
  });

  it("제목 안에 편집 가능 자손이 있어도 그 글자는 담지 않는다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `
      <main id="page">
        <h1 id="title">고객 상세 <span contenteditable="true">김철수 010-1111-2222 메모</span></h1>
        <button id="go">저장</button>
      </main>
    `;
    stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
    stubRect(document.querySelector("#title")!, { x: 20, y: 20, width: 400, height: 40 });
    stubRect(document.querySelector("#go")!, { x: 20, y: 80, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#go")!);

    expect(JSON.stringify(context)).not.toContain("김철수");
  });

  it("링크 안에 textarea 가 있어도 그 글자는 담지 않는다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `
      <main id="page">
        <a id="row" href="/x"><span>행 열기</span><textarea>서울시 성동구 어딘가</textarea></a>
        <button id="go">저장</button>
      </main>
    `;
    stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
    stubRect(document.querySelector("#row")!, { x: 20, y: 20, width: 400, height: 40 });
    stubRect(document.querySelector("#go")!, { x: 20, y: 80, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#go")!);

    expect(JSON.stringify(context)).not.toContain("서울시");
  });

  it("링크 안에 select 가 있으면 이웃 힌트에도 옵션 라벨을 담지 않는다", () => {
    // select 의 option 라벨도 textContent 에 들어간다. containsTextEntrySubtree
    // 가 textarea·contenteditable 만 보면 select 안의 라벨이 이 새어 나간다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `
      <main id="page">
        <a id="row" href="/x"><span>행 열기</span><select><option>김철수</option></select></a>
        <button id="go">저장</button>
      </main>
    `;
    stubRect(document.querySelector("#page")!, { x: 0, y: 0, width: 1440, height: 900 });
    stubRect(document.querySelector("#row")!, { x: 20, y: 20, width: 400, height: 40 });
    stubRect(document.querySelector("#go")!, { x: 20, y: 80, width: 96, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#go")!);

    expect(JSON.stringify(context)).not.toContain("김철수");
  });

  it("클릭 타겟 자신에 select 가 있으면 옵션 라벨을 담지 않는다", () => {
    // 힌트 경로는 TEXT_TAG_WHITELIST 라는 관문이라도 있지만, 타겟 경로
    // (buildScreenTarget)는 화이트리스트 없이 getElementMetadata 텍스트를
    // 그대로 쓴다 — 이 요소를 직접 클릭하면 같은 구멍이 그대로 열린다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<a id="row" href="/x"><span>행 열기</span><select><option>김철수</option></select></a>`;
    stubRect(document.querySelector("#row")!, { x: 20, y: 20, width: 400, height: 40 });

    const context = expectValidScreenContext(document.querySelector("#row")!);

    expect(JSON.stringify(context)).not.toContain("김철수");
  });

  it("select 를 직접 클릭해도 옵션 라벨을 담지 않는다", () => {
    // containsTextEntrySubtree 가 자손만 보면 <select> 자신을 클릭했을 때는
    // querySelector 가 자신을 매칭하지 않아 걸러지지 않는다 — 자신도 봐야 한다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<select id="picker"><option>김철수</option></select>`;
    stubRect(document.querySelector("#picker")!, { x: 20, y: 20, width: 200, height: 32 });

    const context = expectValidScreenContext(document.querySelector("#picker")!);

    expect(JSON.stringify(context)).not.toContain("김철수");
    expect(context.target?.tagName).toBe("select");
    expect(context.target?.rect).toEqual({ x: 20, y: 20, width: 200, height: 32 });
  });
});

describe("getScreenContext 소비자 계약", () => {
  it("공백으로 나열한 ARIA role 토큰 목록을 안전하게 만든다", () => {
    document.title = "설정";
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<div role="none presentation">영역</div>`;
    const element = document.querySelector("div")!;
    stubRect(element, { x: 10, y: 20, width: 200, height: 40 });

    expect(expectValidScreenContext(element).target?.role).toBe("none");
  });

  it("대문자 role 을 안전하게 만든다", () => {
    document.title = "설정";
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<div role="Button">저장</div>`;
    const element = document.querySelector("div")!;
    stubRect(element, { x: 10, y: 20, width: 200, height: 40 });

    expect(expectValidScreenContext(element).target?.role).toBe("button");
  });

  it("뷰포트보다 큰 대상은 화면 프레임만 남기고 대상 정보를 버린다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<div id="wrapper">리포트</div>`;
    const element = document.querySelector("div")!;
    stubRect(element, { x: 0, y: 0, width: 1440, height: 30000 });

    const context = expectValidScreenContext(element);

    expect(context.viewport).toEqual({ width: 1440, height: 900 });
    expect(context.target).toBeUndefined();
  });

  it("페이지 제목을 마스킹해 수집한다", () => {
    // 업무 화면의 title 은 레코드 주체(이름)를 담는 일이 많고 redactScreenText 는
    // 이메일·전화·9자리+ 숫자만 지운다. 사람 이름은 마스킹되지 않지만
    // 미리보기 제목줄이 /list 같은 URL 폴백에서 벗어나는 이득이 있어 수집한다.
    document.title = "김철수 - 고객 상세";
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<button>저장</button>`;
    const element = document.querySelector("button")!;
    stubRect(element, { x: 10, y: 20, width: 96, height: 40 });

    const context = expectValidScreenContext(element);

    expect(context.titleMasked).toBe("김철수 - 고객 상세");
  });

  it("숫자 뒤에 글자가 붙은 120자 초과 대상 텍스트도 이미 마스킹된 값으로 만든다", () => {
    // redactText 는 자체 slice(0, 120) 때문에 멱등이 아니다. 1회 마스킹한 값은
    // 잘린 끝에서 새 단어 경계가 생겨 screenContextSchema 검증에 걸린다.
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<button>${"가".repeat(107)}1234567890123abc</button>`;
    const element = document.querySelector("button")!;
    stubRect(element, { x: 10, y: 20, width: 96, height: 40 });

    const context = expectValidScreenContext(element);

    expect(context.target?.textMaskedOrLimited).toBe(`${"가".repeat(107)}[redacted]`);
  });
});

describe("isPaintedBox", () => {
  it("배경색이 있으면 상자다", () => {
    // 텍스트를 넣지 않는다. 직접 텍스트가 있으면 hasOwnTextNode 만으로도 통과해
    // 배경색 분기를 검증하지 못한다.
    document.body.innerHTML = `<div id="a"></div>`;
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
    // html·body 를 #shell 과 정확히 같은 rect 로 둔다. scanBoxes 가 이제
    // doc.body 이하만 훑어(<head> 예산 낭비를 막는 수정) body·html 자신은 애초에
    // 후보에 오르지 않으므로 dropNearParent 가 셋 중 무엇을 남기든 무관하고,
    // 설령 셋이 함께 후보가 되는 경로가 생기더라도 dropNearParent 는 이제
    // "안쪽"(자손)을 남기므로 칠해지는 #shell 이 살아남는다. 예전엔 이 셋을 4px
    // 문턱 너머로 갈라 둬야 #shell 이 살아남았지만(부모를 남기는 옛 접기
    // 규칙 때문), 이제는 실제 페이지처럼 셋이 같은 rect 여도 문제가 없다.
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

describe("근접-동일 rect 접기는 칠해지는 안쪽을 남긴다", () => {
  // <td><div style="background:#eee">저장</div></td> — div 가 td 를 꽉 채우는
  // 흔한 모양이다. dropNearParent 가 isPaintedBox 보다 먼저 돌기 때문에, 바깥
  // (조상)을 남기면 배경 없는 td 만 남아 다음 칠해짐 판정에서 탈락하고 상자
  // 자체가 사라진다. 안쪽(자손)을 남겨야 살아남는다.
  it("배경 없는 td 가 배경 있는 div 를 감싸고 rect 가 같으면 안쪽 div 가 힌트로 남는다", () => {
    document.body.innerHTML = `
      <div id="click"></div>
      <table><tbody><tr><td id="cell"><div id="fill">저장</div></td></tr></tbody></table>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    const rect = { x: 20, y: 20, width: 80, height: 30 };
    stubRect(document.querySelector("#cell")!, rect);
    stubRect(document.querySelector("#fill")!, rect);
    stubStyle(document.querySelector("#cell")!, { backgroundColor: "rgba(0, 0, 0, 0)", borderTopWidth: "0px" });
    stubStyle(document.querySelector("#fill")!, { backgroundColor: "rgb(238, 238, 238)" });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const hint = context.layoutHints.find(
      (candidate) =>
        candidate.rect.x === rect.x &&
        candidate.rect.y === rect.y &&
        candidate.rect.width === rect.width &&
        candidate.rect.height === rect.height,
    );

    expect(hint).toBeDefined();
    expect(hint?.tagName).toBe("div");
  });
});

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

  // 반대 방향 가드. 문턱이 넓어지면 진짜로 다른 상자가 조용히 사라진다.
  // 이 테스트는 수정 전에도 통과한다 — 목적은 재현이 아니라 고정이다.
  // isNearSameRect 의 문턱을 `< 4` 에서 `< 8` 로 넓히면(예: 6px 어긋난 두 상자를
  // 근사 중복으로 오판) 이 테스트가 잡아낸다 — 확인했다.
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
});

describe("근사 중복이 겹칠 때 masked 요소를 남긴다", () => {
  // 장식용 채움과 입력 요소가 형제로 같은 자리를 차지하면, dropNearParent 가
  // 부모(.field)를 버리고 둘은 서로의 부모가 아니라 둘 다 살아남는다. 그 다음
  // push 의 근사 중복 판정이 먼저 담긴 쪽(면적 큰 .bg)을 남기고 input 을
  // 버려서, 미리보기가 마스킹 사선(pages.css) 대신 평범한 상자를 그린다.
  // 인셋은 1px 이어야 한다 — 2px 면 Δwidth 가 4 라 문턱 `< 4` 를 통과하지
  // 못해 둘 다 담기고, 이 테스트가 수정 전에도 통과해 판별력을 잃는다.
  it("장식용 형제가 1px 감싸도 남는 힌트는 입력 쪽이다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <div id="field"><div id="bg"></div><input id="name" /></div>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#field")!, { x: 20, y: 20, width: 200, height: 40 });
    stubRect(document.querySelector("#bg")!, { x: 20, y: 20, width: 200, height: 40 });
    stubRect(document.querySelector("#name")!, { x: 21, y: 21, width: 198, height: 38 });
    stubStyle(document.querySelector("#bg")!, { backgroundColor: "rgb(238, 238, 238)" });
    stubStyle(document.querySelector("#name")!, { borderTopWidth: "1px" });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const atField = context.layoutHints.filter(
      (hint) => Math.abs(hint.rect.x - 20) < 4 && Math.abs(hint.rect.y - 20) < 4,
    );

    expect(atField).toHaveLength(1);
    expect(atField[0]!.tagName).toBe("input");
    expect(atField[0]!.masked).toBe(true);
  });

  // 인셋 0px 은 이 접기가 만든 손실이 아니다 — 정확 일치 비교 시절에도 두 번째가
  // 버려졌다. 같은 한 줄이 두 대역을 함께 닫는다는 것을 못박는다. rect 가 완전히
  // 같아 담기는 순서가 뒤집혀도 결과는 같다(먼저면 그대로, 나중이면 교체).
  it("장식용 형제와 rect 가 완전히 같아도 남는 힌트는 입력 쪽이다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <div id="field"><div id="bg"></div><input id="name" /></div>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#field")!, { x: 20, y: 20, width: 200, height: 40 });
    stubRect(document.querySelector("#bg")!, { x: 20, y: 20, width: 200, height: 40 });
    stubRect(document.querySelector("#name")!, { x: 20, y: 20, width: 200, height: 40 });
    stubStyle(document.querySelector("#bg")!, { backgroundColor: "rgb(238, 238, 238)" });
    stubStyle(document.querySelector("#name")!, { borderTopWidth: "1px" });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const atField = context.layoutHints.filter(
      (hint) => Math.abs(hint.rect.x - 20) < 4 && Math.abs(hint.rect.y - 20) < 4,
    );

    expect(atField).toHaveLength(1);
    expect(atField[0]!.tagName).toBe("input");
  });

  // 한 방향만 뒤집는다. masked 가 먼저 담혔으면 뒤에 오는 unmasked 는 지금처럼
  // 버려진다 — 이 테스트는 수정 전에도 통과하고, 목적은 재현이 아니라 고정이다.
  // 판정을 "충돌하면 나중 것으로 교체"(masked 조건 없이)로 넘기면 장식용 div 가
  // 입력을 덮어써서 이 테스트가 잡아낸다 — 확인했다.
  it("입력 쪽이 먼저 담혔으면 장식용 형제가 밀어내지 못한다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <div id="field"><input id="name" /><div id="bg"></div></div>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#field")!, { x: 20, y: 20, width: 200, height: 40 });
    stubRect(document.querySelector("#name")!, { x: 20, y: 20, width: 200, height: 40 });
    stubRect(document.querySelector("#bg")!, { x: 21, y: 21, width: 198, height: 38 });
    stubStyle(document.querySelector("#name")!, { borderTopWidth: "1px" });
    stubStyle(document.querySelector("#bg")!, { backgroundColor: "rgb(238, 238, 238)" });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const atField = context.layoutHints.filter(
      (hint) => Math.abs(hint.rect.x - 20) < 4 && Math.abs(hint.rect.y - 20) < 4,
    );

    expect(atField).toHaveLength(1);
    expect(atField[0]!.tagName).toBe("input");
  });

  // 미리보기는 힌트를 배열 순서대로 겹쳐 그린다. 교체를 "지우고 뒤에 다시 담기"
  // 로 구현하면 입력 상자가 배열 끝으로 밀려나 골격 위에 덧그려진다. 제자리
  // 교체는 골격이 잡아둔 자리를 그대로 물려준다. splice + push 로 바꾸면 순서가
  // ["div","div","input"] 이 되어 이 테스트가 잡아낸다 — 확인했다.
  //
  // 픽스처의 함정: #note 의 면적(7,800)이 #bg(8,000)와 #name(7,524) **사이** 여야
  // 한다. 골격은 면적 큰 순이라 그래야 교체가 일어난 뒤에 #note 가 담기고, 두
  // 구현의 순서가 갈린다. #note 를 더 작게 두면 교체가 #note 보다 먼저 끝나
  // 양쪽 다 ["div","input","div"] 가 나와 판별력이 없다 — 처음 이렇게 썼다가
  // 변이가 통과하는 것을 보고 고쳤다.
  it("교체된 힌트는 골격이 잡아둔 자리를 그대로 지킨다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="click"></div>
      <div id="hero"></div>
      <div id="field"><div id="bg"></div><input id="name" /></div>
      <div id="note"></div>
    `;
    stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
    stubRect(document.querySelector("#hero")!, { x: 0, y: 0, width: 600, height: 300 });
    stubRect(document.querySelector("#field")!, { x: 20, y: 400, width: 200, height: 40 });
    stubRect(document.querySelector("#bg")!, { x: 20, y: 400, width: 200, height: 40 });
    stubRect(document.querySelector("#name")!, { x: 21, y: 401, width: 198, height: 38 });
    stubRect(document.querySelector("#note")!, { x: 300, y: 500, width: 130, height: 60 });
    stubStyle(document.querySelector("#hero")!, { backgroundColor: "rgb(200, 200, 200)" });
    stubStyle(document.querySelector("#bg")!, { backgroundColor: "rgb(238, 238, 238)" });
    stubStyle(document.querySelector("#name")!, { borderTopWidth: "1px" });
    stubStyle(document.querySelector("#note")!, { backgroundColor: "rgb(220, 220, 220)" });

    const context = getScreenContext(document.querySelector("#click")!)!;

    expect(context.layoutHints.map((hint) => hint.tagName)).toEqual(["div", "input", "div"]);
  });
});

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
  // 걸친 랜드마크는 지금처럼 잘리는 게 아니라 y:0 으로 밀려 담겨야 한다 —
  // width/height 는 그대로라 저장된 상자는 요소의 실제 아래쪽 경계를 넘어선다.
  // 이 테스트는 수정 전에도 통과한다 — 게이트를 옮기면서 랜드마크 분기의
  // rectFromDomRect 호출까지 걷어내 버리는(그래서 클램프 없는 raw rect 를
  // 그대로 저장하는) 실수를 잡아내는 것으로 확인했다.
  it("절반만 걸친 header 는 y:0 으로 밀려 담긴다", () => {
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

  // 유령 랜드마크가 배제되는 것만으로는 절반이다. 나머지 절반은 그것이
  // MAX_LANDMARK_HINTS(4) 칸을 먹지 않는 것이다 — 문서 순서상 화면 밖
  // 랜드마크가 앞에 있으면, 게이트가 클램프된 rect 를 보던 시절에는 그 넷이
  // 4칸을 다 채우고 진짜 랜드마크가 한 칸도 못 받았다. 네 유령의 height 를
  // 서로 4px 이상씩 벌려 둔다 — y 는 음수라 클램프되면 넷 다 0 으로 접히므로,
  // rect 가 완전히 같으면 push 시점의 근사 중복 제거(isNearSameRect)가 먼저
  // 셋을 걸러내 버려 옛 게이트의 "4칸 다 먹는" 증상 자체가 재현되지 않는다.
  it("화면 밖 랜드마크 4개가 랜드마크 몫을 먹지 않고 진짜 랜드마크가 담긴다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <header id="ghost1"></header>
      <nav id="ghost2"></nav>
      <aside id="ghost3"></aside>
      <div id="ghost4" role="banner"></div>
      <main id="real1"></main>
      <div id="real2" role="complementary"></div>
      <button id="go">저장</button>
    `;
    const ghostHeights: Record<string, number> = { ghost1: 60, ghost2: 70, ghost3: 80, ghost4: 90 };
    for (const [id, height] of Object.entries(ghostHeights)) {
      stubRect(document.querySelector(`#${id}`)!, { x: 0, y: -400, width: 900, height });
    }
    stubRect(document.querySelector("#real1")!, { x: 20, y: 100, width: 700, height: 400 });
    stubRect(document.querySelector("#real2")!, { x: 740, y: 100, width: 200, height: 400 });
    stubRect(document.querySelector("#go")!, { x: 100, y: 550, width: 96, height: 40 });

    const context = getScreenContext(document.querySelector("#go")!)!;
    const rects = context.layoutHints.map((hint) => `${hint.rect.x},${hint.rect.y},${hint.rect.width},${hint.rect.height}`);

    expect(rects).toContain("20,100,700,400");
    expect(rects).toContain("740,100,200,400");
  });

  // domRectIntersectsViewport 는 width<=0 이거나 height<=0 이면 가장자리를 보기도
  // 전에 거절한다. 클램프된 rect 로 게이트를 보던 시절에는 이 판정이 없어, raw
  // {x:10, y:200, width:0, height:50} 인 랜드마크도 뷰포트 안이라고 통과시켰다 —
  // 폭 0인 힌트라도 admin 렌더러는 min-width:18px 로 그려 보이는 유령 상자가
  // 된다(상자 경로의 #zero 픽스처, dom.test.ts:502 근처와 같은 문제의 랜드마크
  // 쪽 짝).
  it("너비가 0인 랜드마크는 힌트에 담기지 않는다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <aside id="empty"></aside>
      <button id="go">저장</button>
    `;
    stubRect(document.querySelector("#empty")!, { x: 10, y: 200, width: 0, height: 50 });
    stubRect(document.querySelector("#go")!, { x: 100, y: 300, width: 96, height: 40 });

    const context = getScreenContext(document.querySelector("#go")!)!;

    expect(context.layoutHints.find((hint) => hint.tagName === "aside")).toBeUndefined();
  });
});

// 실측 회귀 재현: 실제 앱(후보 574개)에서 budgetedCandidates 가 면적 상위 절반을
// 먼저 골라 그 다음에야 isPaintedBox 를 적용하면, 면적 상위가 아무것도 그리지
// 않는 중첩 래퍼로 가득 차 예산이 그 안에서 소진된다. 위 비시맨틱 픽스처(11개
// 요소)는 예산(200)에 전혀 못 미쳐 이 문제를 드러내지 못한다 — 그것이 이 결함이
// 데모 화면을 통과하고도 실제 화면에서 터진 이유다. 여기서는 예산을 실제로
// 소진시킬 만큼 큰 화면을 만든다.
describe("예산이 실제 앱 규모에서 칠해진 상자를 밀어내지 않는다", () => {
  // 그룹 40개 × (래퍼 9겹 + 카드 1개) = 400여 개 후보. 래퍼는 자신을 감싼 셀과
  // 완전히 같은 rect 를 갖는 순수 레이아웃 통로(padding 없는 flex/table 한 자식
  // 구조)라 배경도 테두리도 글자도 없다 — 실제 화면의 div×195·td×156 더미가
  // 이런 모양이다. 카드는 8px 인셋으로 살짝 작고 배경이 있어 실제로 칠해진다.
  const GROUPS = 40;
  const WRAPPER_DEPTH = 9;
  const COLS = 8;
  const CELL_WIDTH = 120;
  const CELL_HEIGHT = 40;
  const GAP = 10;

  function buildRealAppScaleScreen(): Element {
    document.body.innerHTML = `<div id="page"></div>`;
    const page = document.querySelector("#page")!;
    stubRect(page, {
      x: 0,
      y: 0,
      width: COLS * (CELL_WIDTH + GAP),
      height: Math.ceil(GROUPS / COLS) * (CELL_HEIGHT + GAP),
    });

    for (let group = 0; group < GROUPS; group += 1) {
      const col = group % COLS;
      const row = Math.floor(group / COLS);
      const cellRect = {
        x: col * (CELL_WIDTH + GAP),
        y: row * (CELL_HEIGHT + GAP),
        width: CELL_WIDTH,
        height: CELL_HEIGHT,
      };
      let parent: Element = page;
      for (let depth = 0; depth < WRAPPER_DEPTH; depth += 1) {
        const wrapper = document.createElement("div");
        parent.appendChild(wrapper);
        stubRect(wrapper, cellRect); // 자식과 같은 rect — 겹겹이 쌓인 무의미한 래퍼.
        parent = wrapper;
      }
      const card = document.createElement("div");
      parent.appendChild(card);
      stubRect(card, {
        x: cellRect.x + 8,
        y: cellRect.y + 8,
        width: cellRect.width - 16,
        height: cellRect.height - 16,
      });
      stubStyle(card, { backgroundColor: "rgb(230, 230, 230)" }); // 실제로 칠해지는 유일한 노드.
    }

    // 클릭 지점은 격자 한가운데 근처 — 거리 예산 절반이 어디 쪽으로도 치우치지 않게 한다.
    const target = document.createElement("div");
    page.appendChild(target);
    stubRect(target, { x: 4 * (CELL_WIDTH + GAP), y: 2 * (CELL_HEIGHT + GAP), width: 1, height: 1 });
    return target;
  }

  it("힌트를 12개 이상 담는다", () => {
    const target = buildRealAppScaleScreen();
    const context = getScreenContext(target)!;

    expect(context.layoutHints.length).toBeGreaterThanOrEqual(12);
  });
});

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

describe("클릭 근처 후보에도 뷰포트 전체를 덮는 상자를 뺀다", () => {
  // 반투명 모달 백드롭(inset:0)의 중심은 뷰포트 중심과 거의 같아, 클릭이
  // 그 근처에서 일어나면 중심 거리 기준으로 근처 랭킹 1위가 된다. 골격에서만
  // 뷰포트 비율 필터를 적용하면 백드롭이 근처 쪽으로 새어 들어가고, 힌트는
  // 배열 순서로 그려지는 데다 미리보기가 반투명으로 칠하므로 맨 나중에 그려져
  // 미리보기 전체를 덮는다.
  it("풀뷰포트 백드롭은 근처 후보에서도 제외되고, 더 작은 실제 콘텐츠는 남는다", () => {
    window.innerWidth = 1000;
    window.innerHeight = 700;
    document.body.innerHTML = `
      <div id="backdrop"></div>
      <div id="modal">확인</div>
      <div id="click"></div>
    `;
    stubRect(document.querySelector("#backdrop")!, { x: 0, y: 0, width: 1000, height: 700 });
    stubStyle(document.querySelector("#backdrop")!, { backgroundColor: "rgba(0, 0, 0, 0.5)" });
    stubRect(document.querySelector("#modal")!, { x: 480, y: 330, width: 40, height: 40 });
    stubStyle(document.querySelector("#modal")!, { backgroundColor: "rgb(255, 255, 255)" });
    stubRect(document.querySelector("#click")!, { x: 500, y: 350, width: 2, height: 2 });

    const context = getScreenContext(document.querySelector("#click")!)!;
    const viewportArea = 1000 * 700;

    for (const hint of context.layoutHints) {
      expect(hint.rect.width * hint.rect.height).toBeLessThan(viewportArea * 0.9);
    }
    expect(context.layoutHints).toContainEqual(
      expect.objectContaining({ rect: { x: 480, y: 330, width: 40, height: 40 } }),
    );
  });
});

describe("비용 상한", () => {
  // 문서가 커져도 클릭당 비용이 묶여야 한다. getComputedStyle 은 리플로우를 부르므로
  // 호출 횟수가 곧 비용이다. 분노 클릭은 연타라 이 값이 그대로 곱해진다.
  it("getComputedStyle 호출이 클릭당 200을 넘지 않는다", () => {
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

    expect(spy.mock.calls.length).toBeLessThanOrEqual(200);
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

  // CSS-in-JS(emotion·styled-components)는 컴포넌트마다 <style> 을 <head> 에
  // 심는다. <head> 를 포함해 문서 전체를 훑으면 문서 순서상 이 더미가 body
  // 도달 전에 MAX_RECT_SCAN 예산을 다 써서 힌트가 0에 가깝게 무너진다 — 실제로
  // 보지 못한 페이지에서 재현되는, 최초의 "빈 미리보기" 증상과 같은 모양이다.
  it("head 의 style 더미가 MAX_RECT_SCAN 을 다 써도 body 의 칠해진 상자를 놓치지 않는다", () => {
    document.head.innerHTML = Array.from({ length: 3100 }, () => "<style>.x{color:red}</style>").join("");
    try {
      document.body.innerHTML = `<div id="click"></div><div id="box">저장</div>`;
      stubRect(document.querySelector("#click")!, { x: 500, y: 500, width: 10, height: 10 });
      stubRect(document.querySelector("#box")!, { x: 100, y: 100, width: 80, height: 30 });

      const context = getScreenContext(document.querySelector("#click")!)!;

      expect(
        context.layoutHints.some(
          (hint) => hint.tagName === "div" && hint.rect.x === 100 && hint.rect.y === 100,
        ),
      ).toBe(true);
    } finally {
      // beforeEach 는 body 만 비운다. head 는 직접 정리해 다음 테스트로 새지 않게 한다.
      document.head.innerHTML = "";
    }
  });

  // scanBoxes 는 getScreenContext 를 거치지 않고 직접 부를 수 있다 — iframe
  // 내부를 스캔할 때 scanFrameBoxes 가 실제 오프셋으로 이 함수를 부르므로,
  // 음수 원시 좌표 + 오프셋 조합이 실전에서도 그대로 일어난다. 여기서는 그
  // 경로를 거치지 않고 계산 자체를 고정해 둔다.
  it("scanBoxes 는 음수 원시 좌표에 오프셋을 더할 때 클램프를 한 번만, 더한 뒤에 한다", () => {
    document.body.innerHTML = `<div id="straddle">걸친 상자</div>`;
    // 왼쪽으로 걸친 요소: 원시 x 는 -50 이지만 폭 100 이라 오른쪽 절반(0~50)이
    // 뷰포트 안에 실제로 보인다 — 스캔 후보에서 제외돼선 안 된다.
    stubRect(document.querySelector("#straddle")!, { x: -50, y: 0, width: 100, height: 40 });
    const viewport = { width: 1440, height: 900 };
    const targetRect = { x: 0, y: 0, width: 1, height: 1 };

    // 프레임이 부모 문서에서 x:200 만큼 오프셋된 상황을 흉내낸다.
    const candidates = scanBoxes(document, viewport, targetRect, { x: 200, y: 0 });
    const straddle = candidates.find((candidate) => candidate.element.id === "straddle");

    // 올바른 계산: clamp(-50 + 200) = 150.
    // 먼저 클램프하는 잘못된 계산: clamp(clamp(-50) + 200) = clamp(0 + 200) = 200.
    // 200 이 나오면 클램프 순서가 다시 뒤바뀐 것이다.
    expect(straddle).toBeDefined();
    expect(straddle?.rect.x).toBe(150);
  });
});

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

  // 프레임의 원시 rect 가 음수(뷰포트 위/왼쪽으로 걸치거나 완전히 벗어남)일 때
  // 클램프 순서가 끝까지 지켜지는지 못박는다. scanFrameBoxes 가 rectFromDomRect
  // 로 먼저 클램프한 값을 게이트·오프셋에 쓰면: (1) 완전히 벗어난 프레임의
  // x/y 가 0 으로 접혀 뷰포트 게이트를 잘못 통과하고, (2) 통과한 프레임의
  // 오프셋도 0 이 되어 내부 요소가 실제보다 아래/오른쪽으로 밀려 그려진다.
  it("뷰포트 위로 걸친 프레임 내부 상자는 음수만큼 보정되어 저장된다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<div id="side">사이드</div><iframe id="f"></iframe>`;
    const frame = document.querySelector("#f") as HTMLIFrameElement;
    stubRect(document.querySelector("#side")!, { x: 0, y: 600, width: 300, height: 200 });
    // 뷰포트 위/왼쪽으로 걸친 프레임: 원시 x:-200,y:-150 이지만 폭·높이가 커서
    // 오른쪽/아래 일부가 뷰포트 안에 실제로 보인다.
    stubRect(frame, { x: -200, y: -150, width: 800, height: 600 });
    const innerDoc = frame.contentDocument!;
    innerDoc.body.innerHTML = `<div id="in">본문</div>`;
    stubRect(innerDoc.querySelector("#in")!, { x: 250, y: 300, width: 100, height: 80 });

    const context = getScreenContext(document.querySelector("#side")!)!;
    // 올바른 계산: clamp(250 + -200) = 50, clamp(300 + -150) = 150.
    // 먼저 클램프하는 잘못된 계산: clamp(250 + clamp(-200)) = clamp(250 + 0) = 250.
    expect(context.layoutHints).toContainEqual(
      expect.objectContaining({ rect: { x: 50, y: 150, width: 100, height: 80 } }),
    );
  });

  // 숨김 shim(예: position:absolute; left:-9999px 인 인쇄·다운로드용 iframe)은
  // 클램프된 rect 로 보면 x:0 이 되어 뷰포트 게이트를 통과한다. 원시 rect 로
  // 봐야 뷰포트 밖이라는 게 드러나 문서 자체를 스캔하지 않는다.
  it("뷰포트 밖 멀리 걸린 숨김 프레임은 문서를 스캔하지 않는다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<div id="side">사이드</div><iframe id="f"></iframe>`;
    const frame = document.querySelector("#f") as HTMLIFrameElement;
    stubRect(document.querySelector("#side")!, { x: 0, y: 0, width: 300, height: 600 });
    stubRect(frame, { x: -9999, y: 0, width: 200, height: 100 });
    const innerDoc = frame.contentDocument!;
    innerDoc.body.innerHTML = `<div id="in">보이면 안 되는 내용</div>`;
    stubRect(innerDoc.querySelector("#in")!, { x: 10, y: 10, width: 100, height: 50 });

    const context = getScreenContext(document.querySelector("#side")!)!;

    expect(
      context.layoutHints.some((hint) => hint.rect.width === 100 && hint.rect.height === 50),
    ).toBe(false);
  });

  // 실제 브라우저에서 다른 출처 프레임은 contentDocument 가 null 을 돌려주고,
  // 던지는 것은 contentWindow.document 다(2026-09-04 실측). 우리 코드는
  // contentDocument 만 읽으므로 실전에서는 null 경로를 탄다 — 그 경로는 아래
  // "contentDocument 가 null 이어도" 테스트가 덮는다.
  //
  // 이 테스트는 일부러 더 가혹하게, contentDocument 자체가 던지게 만들어
  // sameOriginDocument 의 방어적 try/catch 를 실행시킨다. 그 대가로 jsdom 의
  // iframe:focus 매칭이 같은 getter 를 읽어 getComputedStyle 안에서도 터지는데,
  // 이는 실제 브라우저에 없는 인공물이다.
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

    const context = getScreenContext(document.querySelector("#side")!);

    // not.toThrow() 로는 못 잡는다 — getScreenContext 의 바깥 try/catch 가 모든
    // 예외를 삼켜 undefined 를 돌려주므로 그 단정은 구현과 무관하게 통과한다.
    // 널 가드가 빠지면 scanBoxes 가 null.querySelectorAll 에서 터지고 여기서
    // context 자체가 undefined 가 된다.
    expect(context).toBeDefined();
    expect(context!.layoutHints).toContainEqual(
      expect.objectContaining({ tagName: "iframe", rect: { x: 400, y: 100, width: 600, height: 500 } }),
    );
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
    const innerHint = context.layoutHints.find(
      (hint) => hint.rect.x === 410 && hint.rect.y === 120 && hint.rect.width === 500 && hint.rect.height === 400,
    );

    // 부정 단정(글자가 없다)만 있으면 프레임 스캔이 아무것도 만들지 않아도
    // 통과한다 — 상자가 실제로 수집됐다는 긍정 단정을 함께 못박는다.
    expect(innerHint).toBeDefined();
    expect(innerHint?.textMaskedOrLimited).toBeUndefined();
    for (const hint of context.layoutHints) {
      expect(hint.textMaskedOrLimited).not.toBe("비밀 문서 내용");
    }
  });

  // 프레임마다 MAX_RECT_SCAN(3,000) 전체를 다시 훑으므로 상한이 없으면 프레임이
  // 많은 문서(에디터 여러 개, 결제·미리보기 위젯 등)에서 클릭당 비용이 프레임
  // 수에 비례해 계속 커진다. 열 개 중 같은 출처 네 개(MAX_SCANNED_FRAMES)만
  // 기여하는지 — 다섯 번째부터는 내부를 아예 스캔하지 않는지 — 직접 못박는다.
  // "getBoundingClientRect 호출 총량" 이 아니라 "몇 번째 프레임까지 기여했는가"
  // 를 고른 이유: 호출 총량은 scanBoxes 내부 구현(문서당 3,000 상한)에 얽혀
  // MAX_SCANNED_FRAMES 하나만 바뀌어도 함께 흔들리는데, 기여 프레임 개수는
  // scanFrameBoxes 의 반복 자체를 직접 가리켜 더 정직하다.
  it("같은 출처 프레임은 MAX_SCANNED_FRAMES(4)개까지만 내부를 스캔한다", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    const FRAME_COUNT = 10;
    let html = `<div id="click"></div>`;
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      html += `<iframe id="f${index}"></iframe>`;
    }
    document.body.innerHTML = html;
    stubRect(document.querySelector("#click")!, { x: 900, y: 800, width: 4, height: 4 });

    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const frame = document.querySelector(`#f${index}`) as HTMLIFrameElement;
      // 세로로 늘어선 10개의 프레임. 전부 뷰포트 안에 들어온다.
      stubRect(frame, { x: 0, y: index * 70, width: 100, height: 60 });
      const innerDoc = frame.contentDocument!;
      innerDoc.body.innerHTML = `<div id="inner">프레임 내부 ${index}</div>`;
      stubRect(innerDoc.querySelector("#inner")!, { x: 10, y: 10, width: 40, height: 40 });
    }

    const context = getScreenContext(document.querySelector("#click")!)!;
    // 프레임 i 의 내부 div 는 부모 기준 x:10, y: i*70+10 이다.
    const innerYs = context.layoutHints
      .filter((hint) => hint.rect.x === 10 && hint.rect.width === 40 && hint.rect.height === 40)
      .map((hint) => hint.rect.y)
      .sort((left, right) => left - right);

    expect(innerYs).toEqual([10, 80, 150, 220]);
  });

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
});
