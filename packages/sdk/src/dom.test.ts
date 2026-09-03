import { screenContextSchema } from "@trace/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getElementMetadata, getScreenContext } from "./dom.js";

// 이전 테스트가 남긴 DOM 이 다음 테스트로 새면 rect 가 우연히 0으로 겹치는 등
// 재현 불가능한 통과/실패가 생긴다. 매 테스트를 빈 body 에서 시작한다.
beforeEach(() => {
  document.body.innerHTML = "";
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
    // section 은 이웃 셀렉터에도 랜드마크에도 없어 아예 수집되지 않는다.
    expect(byTag("section")).toBeUndefined();
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

  it("후보가 많아도 힌트는 정확히 12개로 잘린다", () => {
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

    // 80개의 버튼 + main 랜드마크가 모두 뷰포트 안에 있으므로 개수는 상한
    // 12로 결정적이다. <= 12 만 보면 생산자가 조용히 힌트를 덜 채워도 통과한다.
    expect(context.layoutHints.length).toBe(12);
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

  it("페이지 제목은 수집하지 않는다", () => {
    // 업무 화면의 title 은 레코드 주체(이름)를 담는 일이 많고 redactText 는
    // 이메일·전화·9자리+ 숫자만 지운다. 미리보기는 urlPath 폴백을 쓴다.
    document.title = "김철수 - 고객 상세";
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<button>저장</button>`;
    const element = document.querySelector("button")!;
    stubRect(element, { x: 10, y: 20, width: 96, height: 40 });

    const context = expectValidScreenContext(element);

    expect(context).not.toHaveProperty("titleMasked");
    expect(JSON.stringify(context)).not.toContain("김철수");
    document.title = "설정";
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
