import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_INTERVAL_MS,
  isSafeMaskSelector,
  MAX_MASK_SELECTOR_LENGTH,
} from "./recording-limits.js";

describe("recording limits", () => {
  it("체크포인트 주기는 2분이다", () => {
    expect(CHECKPOINT_INTERVAL_MS).toBe(120_000);
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

  // 쉼표를 받아 두면 항목 하나가 목록이 된다 - 그래서 끝에 쉼표가 붙은
  // ".customer-name," 처럼 **컴파일되지 않는** 문자열이 검증을 통과했다. rrweb 의
  // needMaskingText 는 모든 텍스트 노드에서 closest 를 부르므로 그 SyntaxError
  // 하나가 기록을 통째로 죽인다(실측: Meta 하나만 나가고 FullSnapshot 이 없다).
  // 여러 셀렉터는 목록 항목을 여럿 두면 된다 - 한 항목 안에 쉼표를 둘 이유가 없다.
  it("쉼표를 거절한다", () => {
    expect(isSafeMaskSelector(".customer-name,")).toBe(false);
    expect(isSafeMaskSelector(".customer-name,td.amount")).toBe(false);
    expect(isSafeMaskSelector(",")).toBe(false);
  });
});
