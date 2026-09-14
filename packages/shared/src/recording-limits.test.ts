import { describe, expect, it } from "vitest";
import {
  BUFFERED_CHECKPOINT_GENERATIONS,
  CHECKPOINT_INTERVAL_MS,
  isSafeMaskSelector,
  MAX_MASK_SELECTOR_LENGTH,
} from "./recording-limits.js";

describe("recording limits", () => {
  it("체크포인트 주기는 2분이다", () => {
    expect(CHECKPOINT_INTERVAL_MS).toBe(120_000);
  });

  // 세대 1개면 체크포인트 직후에 난 문제의 앞 맥락이 0초가 된다.
  it("체크포인트를 두 세대 쥔다", () => {
    expect(BUFFERED_CHECKPOINT_GENERATIONS).toBe(2);
  });

  it("평범한 CSS 셀렉터를 받는다", () => {
    expect(isSafeMaskSelector(".customer-name")).toBe(true);
    expect(isSafeMaskSelector("td.amount > span")).toBe(true);
    expect(isSafeMaskSelector('[data-pii="true"]')).toBe(true);
  });

  it("빈 값과 상한을 넘는 길이를 거절한다", () => {
    expect(isSafeMaskSelector("")).toBe(false);
    expect(isSafeMaskSelector("a".repeat(MAX_MASK_SELECTOR_LENGTH + 1))).toBe(false);
  });

  it("줄바꿈·중괄호처럼 셀렉터가 아닌 문자를 거절한다", () => {
    expect(isSafeMaskSelector("a\nb")).toBe(false);
    expect(isSafeMaskSelector("body{display:none}")).toBe(false);
  });
});
