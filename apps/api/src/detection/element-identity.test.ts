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
