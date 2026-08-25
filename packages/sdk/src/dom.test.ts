import { describe, expect, it } from "vitest";
import { getElementMetadata } from "./dom";

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
