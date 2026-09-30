import { describe, expect, it } from "vitest";
import { hash64Hex } from "./hash.js";
import { isSafeElementSelectorHash } from "./privacy.js";

// 앞 8 hex 는 31 누산기 레인, 뒤 8 hex 는 FNV 레인이다. 폭을 32비트에서 64비트로
// 넓힌 근거가 "누산기 하나가 지배하지 않는다" 였으므로, 두 슬롯이 각각 입력에
// 반응한다는 것을 슬롯 단위로 못박는다. 슬롯을 나눠 보지 않으면 한 레인을 버리고
// 0 으로 채운 구현(low 만 16 hex 로 pad, high 만 16 hex 로 pad)이 전부 통과한다.
function lowLane(input: string): string {
  return hash64Hex(input).slice(0, 8);
}

function highLane(input: string): string {
  return hash64Hex(input).slice(8);
}

const LANE_INPUTS = [
  "body>main>form>button",
  "body>main>div>button",
  "body>main>div>input[name=\"email\"]",
  "body>section>ul>li",
  "button",
  "a[role=\"link\"]",
  "가나다",
  "x".repeat(64),
];

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

  it("앞 8 hex(31 누산기 레인)가 입력에 따라 변한다", () => {
    const lanes = new Set(LANE_INPUTS.map(lowLane));

    // 상수 하나로 접히면 그 레인은 지문에 아무것도 기여하지 않는다.
    expect(lanes.size).toBeGreaterThan(1);
    expect(lanes.has("00000000")).toBe(false);
  });

  it("뒤 8 hex(FNV 레인)가 입력에 따라 변한다", () => {
    const lanes = new Set(LANE_INPUTS.map(highLane));

    expect(lanes.size).toBeGreaterThan(1);
    expect(lanes.has("00000000")).toBe(false);
  });

  it("두 레인이 최하위 비트에서 서로 독립이다", () => {
    // 31·16777619 가 둘 다 홀수라, 마무리 혼합이 없으면 각 레인의 bit0 이 입력
    // 문자 코드의 패리티로 환원되어 bit0(뒤) 이 언제나 bit0(앞) 의 여집합이 된다.
    // 그러면 폭은 64비트인데 혼합은 63비트다. 두 조합이 모두 나타나는지 본다.
    const combinations = new Set(
      LANE_INPUTS.map((input) => {
        const hash = hash64Hex(input);
        const low = parseInt(hash.slice(0, 8), 16) & 1;
        const high = parseInt(hash.slice(8), 16) & 1;
        return low === high ? "same" : "complement";
      }),
    );

    expect(combinations).toEqual(new Set(["same", "complement"]));
  });

  it("events.element_key 에 저장되는 출력이므로 알고리즘을 고정한다", () => {
    // hash.ts 의 경고대로 이 값은 events.element_key 에 저장된다
    // (apps/api/src/store/element-key.ts). 이 리터럴이
    // 깨졌다면 해시를 "고친" 것이 아니라 저장된 요소 키 형식을 바꾼 것이므로
    // 마이그레이션이 필요하다. 느슨한 검사로 바꾸지 말고 값을 다시 계산할지
    // 마이그레이션을 쓸지 판단한다. Math.imul 을 평범한 곱셈으로 바꾸면
    // 2^53 을 넘겨 하위 비트를 잃는데, 그 회귀도 이 리터럴이 잡는다.
    expect(hash64Hex("body>main>form>button#save[type=\"submit\"]")).toBe("ee14f4f5e76b6a90");
    expect(hash64Hex("body>main>div>button")).toBe("5f69e3b3df5a8787");
    expect(hash64Hex("")).toBe("d540468f27f60aff");
  });
});
