import { screenContextSchema } from "@trace/shared";
import { describe, expect, it, vi } from "vitest";
import { getElementMetadata, getScreenContext } from "./dom.js";

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
