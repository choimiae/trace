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
