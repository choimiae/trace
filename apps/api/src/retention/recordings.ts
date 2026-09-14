import type { TraceStore } from "../store/types.js";
import type { SessionRecordingRetentionConfig } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function sessionRecordingCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

// runEventRetention 과 달리 "설정이 없으면 아무것도 안 함" 분기가 없다.
// 세션 기록은 기본값이 있어 언제나 만료된다.
export async function runSessionRecordingRetention(
  store: TraceStore,
  config: SessionRecordingRetentionConfig,
  now: Date = new Date(),
): Promise<number> {
  return store.deleteSessionRecordingsBefore(
    sessionRecordingCutoff(now, config.sessionRecordingRetentionDays),
  );
}
