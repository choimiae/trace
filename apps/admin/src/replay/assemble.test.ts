import { describe, expect, it } from "vitest";
import { assembleChunk } from "./assemble.js";

describe("assembleChunk", () => {
  it("봉투에서 events 를 꺼낸다", () => {
    const result = assembleChunk({
      projectId: "proj_a",
      seq: 0,
      startedAt: "2026-09-15T00:00:00.000Z",
      url: "https://demo.example.com/",
      sdkVersion: "0.1.0",
      events: [{ type: 2 }, { type: 3 }],
    });

    expect(result).toEqual({ ok: true, events: [{ type: 2 }, { type: 3 }] });
  });

  it("events 가 배열이 아니면 읽지 못한 것으로 본다", () => {
    expect(assembleChunk({ events: "nope" })).toEqual({ ok: false, reason: "unreadable" });
  });

  it("객체가 아니면 읽지 못한 것으로 본다", () => {
    expect(assembleChunk(null)).toEqual({ ok: false, reason: "unreadable" });
    expect(assembleChunk("[]")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("빈 events 는 읽은 것이다 - 이벤트가 0개인 청크는 정상이 아니지만 깨진 것도 아니다", () => {
    expect(assembleChunk({ events: [] })).toEqual({ ok: true, events: [] });
  });

  // 이벤트 본문은 검증하지 않는다. 모양이 rrweb 버전에 묶여 있다(A 스펙 §5).
  it("이벤트 본문이 무엇이든 그대로 통과시킨다", () => {
    const weird = [{ 총: "알 수 없는 모양" }, 42, null];
    expect(assembleChunk({ events: weird })).toEqual({ ok: true, events: weird });
  });
});
