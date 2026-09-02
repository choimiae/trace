import { describe, expect, it, vi } from "vitest";
import { getElementMetadata, getScreenContext } from "./dom.js";

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
});
