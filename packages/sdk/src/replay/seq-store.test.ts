import { afterEach, describe, expect, it } from "vitest";
import { REPLAY_SEQ_KEY } from "../storage.js";
import { readNextSeq, writeNextSeq } from "./seq-store.js";

afterEach(() => sessionStorage.clear());

describe("seq-store", () => {
  it("같은 세션이 남긴 다음 번호를 읽는다", () => {
    writeNextSeq("sess_1", 5);

    expect(readNextSeq("sess_1")).toBe(5);
  });

  it("다른 세션이 남긴 번호는 쓰지 않는다", () => {
    writeNextSeq("sess_other", 9);

    expect(readNextSeq("sess_1")).toBe(0);
  });

  it.each([
    ["없음", null],
    ["JSON 이 아님", "{oops"],
    ["음수", JSON.stringify({ sessionId: "sess_1", next: -1 })],
    ["소수", JSON.stringify({ sessionId: "sess_1", next: 1.5 })],
  ])("값이 쓸 수 없으면 0 부터 매긴다 (%s)", (_label, raw) => {
    if (raw !== null) sessionStorage.setItem(REPLAY_SEQ_KEY, raw);

    expect(readNextSeq("sess_1")).toBe(0);
  });
});
