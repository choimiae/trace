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

  it("따로 만든 같은 쌍도 같은 키를 낸다", () => {
    // 같은 객체를 두 번 넘기면(elementKey(event) === elementKey(event)) 상수나
    // undefined 를 돌려주는 구현까지 통과한다. 신원이 다른 두 객체로 비교하고,
    // 쌍 밖의 필드(eventId)는 키에 섞이지 않는다는 것도 함께 못박는다.
    const first = elementKey(
      click({ eventId: "evt_a", elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "삭제" }),
    );
    const second = elementKey(
      click({ eventId: "evt_b", elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "삭제" }),
    );

    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(second).toBe(first);
  });

  it("지문과 글자의 경계가 겹쳐도 키가 충돌하지 않는다", () => {
    // 구분자가 없으면 "ab" + "cd" 와 "abc" + "d" 가 같은 입력이 된다.
    const left = elementKey(click({ elementSelectorHash: "ab", elementTextMaskedOrLimited: "cd" }));
    const right = elementKey(click({ elementSelectorHash: "abc", elementTextMaskedOrLimited: "d" }));

    expect(left).not.toBe(right);
  });
});

// 아래는 바람직한 성질이 아니라 spec 4장 "남는 한계" 에 기록된, 의도적으로
// 받아들인 대가를 못박는 테스트다. 아이콘 전용 버튼은 textContent 가 비어
// aria-label 이 유일한 라벨이 되고(sdk/src/dom.ts 의 allowedElementText),
// 그 라벨이 레코드 주체를 담으면 목록 행마다 다른 요소로 갈린다. 라벨을 신원에서
// 빼는 "수정" 은 같은 행 안의 서로 다른 아이콘 버튼을 구분 불가로 만들고, 행을
// 인식하는 깔끔한 해법은 spec 1장이 금지한 형제 순서번호를 요구한다.
//
// 이 단정이 깨졌다면 동작이 좋아진 것이 아니라 그 판단이 뒤집힌 것이다. 테스트를
// 고치기 전에 spec 4장부터 고쳐야 한다.
describe("aria-label 이 신원에 섞이는 알려진 한계 (spec 4장)", () => {
  it("지문이 같고 aria-label 만 다른 행 버튼은 지금 서로 다른 요소로 갈린다", () => {
    // <button aria-label="김철수 삭제"><svg/></button> 가 행마다 반복된 모양.
    const first = click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "김철수 삭제" });
    const second = click({ elementSelectorHash: "aaaaaaaabbbbbbbb", elementTextMaskedOrLimited: "이영희 삭제" });

    expect(sameElement(first, second)).toBe(false);
    expect(elementKey(first)).not.toBe(elementKey(second));
  });
});
