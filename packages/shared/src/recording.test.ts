import { describe, expect, it } from "vitest";
import { MAX_RECORDING_CHUNK_EVENTS } from "./recording-limits.js";
import { recordingChunkSchema, replayConfigSchema } from "./recording.js";

const validChunk = {
  projectId: "proj_abc123",
  seq: 0,
  startedAt: "2026-09-14T00:00:00.000Z",
  url: "https://demo.example.com/orders",
  sdkVersion: "0.1.0",
  events: [{ type: 2, timestamp: 1 }],
};

describe("replayConfigSchema", () => {
  it("셀렉터를 생략하면 빈 목록이 된다", () => {
    expect(replayConfigSchema.parse({ enabled: true })).toEqual({
      enabled: true,
      maskSelectors: [],
    });
  });

  it("안전하지 않은 셀렉터를 거절한다", () => {
    expect(() =>
      replayConfigSchema.parse({ enabled: true, maskSelectors: ["body{x:1}"] }),
    ).toThrow();
  });
});

describe("recordingChunkSchema", () => {
  it("봉투를 검증한다", () => {
    expect(recordingChunkSchema.parse(validChunk).seq).toBe(0);
  });

  // 이벤트 본문 모양은 rrweb 버전에 묶여 있다. 계약으로 고정하면 라이브러리를
  // 올릴 때마다 서버가 멀쩡한 기록을 400 으로 떨어뜨린다.
  it("rrweb 이벤트의 내부 구조는 보지 않는다", () => {
    const parsed = recordingChunkSchema.parse({
      ...validChunk,
      events: [{ 무엇이든: "들어온다" }, 42, null],
    });
    expect(parsed.events).toHaveLength(3);
  });

  it("이벤트가 하나도 없는 청크를 거절한다", () => {
    expect(() => recordingChunkSchema.parse({ ...validChunk, events: [] })).toThrow();
  });

  it("프로젝트 식별자 모양을 검증한다", () => {
    expect(() => recordingChunkSchema.parse({ ...validChunk, projectId: "sess_abc" })).toThrow();
  });

  // 이벤트 내부 구조는 안 보지만 개수 상한은 계약이 직접 막는다. 실제 rrweb
  // 이벤트를 5만 개 만들 필요는 없다 - events 는 z.unknown() 이라 자리채움으로
  // 충분하다.
  it("이벤트 개수가 상한을 넘으면 거절한다", () => {
    const tooMany = Array.from({ length: MAX_RECORDING_CHUNK_EVENTS + 1 }, () => null);
    expect(() => recordingChunkSchema.parse({ ...validChunk, events: tooMany })).toThrow();
  });
});
