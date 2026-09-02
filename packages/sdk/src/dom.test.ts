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
      titleMasked: "설정",
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
});

// 생산자(SDK)가 만든 값은 소비자(수집 API)의 screenContextSchema 를 항상 통과해야 한다.
// 통과하지 못하면 배치 전체가 400 이 되고 SDK 큐가 영구히 막힌다.
describe("getScreenContext 소비자 계약", () => {
  const expectValidScreenContext = (element: Element) => {
    const context = getScreenContext(element);
    expect(context).toBeDefined();
    const parsed = screenContextSchema.safeParse(context);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    return context!;
  };

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

  it("뷰포트보다 큰 대상은 화면 이름만 남기고 대상 정보를 버린다", () => {
    document.title = "월간 리포트";
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<div id="wrapper">리포트</div>`;
    const element = document.querySelector("div")!;
    stubRect(element, { x: 0, y: 0, width: 1440, height: 30000 });

    const context = expectValidScreenContext(element);

    expect(context.titleMasked).toBe("월간 리포트");
    expect(context.target).toBeUndefined();
  });

  it("숫자 뒤에 글자가 붙은 120자 초과 제목도 이미 마스킹된 값으로 만든다", () => {
    // redactText 는 자체 slice(0, 120) 때문에 멱등이 아니다. 1회 마스킹한 값은
    // 잘린 끝에서 새 단어 경계가 생겨 screenContextSchema 검증에 걸린다.
    document.title = `${"가".repeat(107)}1234567890123abc`;
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<button>저장</button>`;
    const element = document.querySelector("button")!;
    stubRect(element, { x: 10, y: 20, width: 96, height: 40 });

    const context = expectValidScreenContext(element);

    expect(context.titleMasked).toBe(`${"가".repeat(107)}[redacted]`);
    document.title = "설정";
  });
});
