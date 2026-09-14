import { describe, expect, it } from "vitest";
import { loadEventRetentionConfig, loadSessionRecordingRetentionConfig } from "./config.js";

describe("event retention config", () => {
  it("disables event retention when EVENT_RETENTION_DAYS is absent", () => {
    expect(loadEventRetentionConfig({})).toEqual({});
  });

  it("parses EVENT_RETENTION_DAYS as a positive safe integer", () => {
    expect(loadEventRetentionConfig({ EVENT_RETENTION_DAYS: "30" })).toEqual({ eventRetentionDays: 30 });
  });

  it.each(["0", "-1", "1.5", "abc", "9007199254740992"])("rejects invalid EVENT_RETENTION_DAYS=%s", (value) => {
    expect(() => loadEventRetentionConfig({ EVENT_RETENTION_DAYS: value })).toThrow("EVENT_RETENTION_DAYS");
  });
});

describe("loadSessionRecordingRetentionConfig", () => {
  // EVENT_RETENTION_DAYS 와 일부러 다르다. 그쪽은 기본값이 없어 설정하지 않으면
  // 영원히 쌓이는데, 세션 기록은 이벤트 한 건(6 KB)의 25배(150 KB)이고
  // 개인정보 구멍의 크기가 보존 기간에 비례한다.
  it("설정하지 않으면 7일이다", () => {
    expect(loadSessionRecordingRetentionConfig({})).toEqual({ sessionRecordingRetentionDays: 7 });
  });

  it("환경 변수로 덮어쓴다", () => {
    expect(loadSessionRecordingRetentionConfig({ SESSION_RECORDING_RETENTION_DAYS: "30" })).toEqual({
      sessionRecordingRetentionDays: 30,
    });
  });

  it("양의 정수가 아니면 던진다", () => {
    expect(() => loadSessionRecordingRetentionConfig({ SESSION_RECORDING_RETENTION_DAYS: "0" })).toThrow();
    expect(() => loadSessionRecordingRetentionConfig({ SESSION_RECORDING_RETENTION_DAYS: "week" })).toThrow();
  });
});
