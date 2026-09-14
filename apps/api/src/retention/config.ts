export interface EventRetentionConfig {
  eventRetentionDays?: number;
}

export function loadEventRetentionConfig(env: NodeJS.ProcessEnv): EventRetentionConfig {
  const rawDays = env.EVENT_RETENTION_DAYS?.trim();
  if (!rawDays) return {};

  const eventRetentionDays = Number(rawDays);
  if (!Number.isSafeInteger(eventRetentionDays) || eventRetentionDays <= 0) {
    throw new Error("EVENT_RETENTION_DAYS must be a positive safe integer");
  }

  return { eventRetentionDays };
}

/**
 * EVENT_RETENTION_DAYS 와 달리 기본값을 둔다. 이벤트 한 건이 약 6 KB 인데 세션
 * 기록은 10분에 약 150 KB 로 25배고, 무엇보다 마스킹의 정본이 SDK 한 곳뿐이라
 * (서버가 재판정할 수 없다) 개인정보 구멍의 크기가 보존 기간에 그대로 비례한다.
 * 링크로 둔 CSS 때문에 오래된 기록은 어차피 스타일이 깨진다 - 길게 둘 값이 없다.
 */
export const DEFAULT_SESSION_RECORDING_RETENTION_DAYS = 7;

export interface SessionRecordingRetentionConfig {
  sessionRecordingRetentionDays: number;
}

export function loadSessionRecordingRetentionConfig(
  env: NodeJS.ProcessEnv,
): SessionRecordingRetentionConfig {
  const rawDays = env.SESSION_RECORDING_RETENTION_DAYS?.trim();
  if (!rawDays) {
    return { sessionRecordingRetentionDays: DEFAULT_SESSION_RECORDING_RETENTION_DAYS };
  }

  const sessionRecordingRetentionDays = Number(rawDays);
  if (!Number.isSafeInteger(sessionRecordingRetentionDays) || sessionRecordingRetentionDays <= 0) {
    throw new Error("SESSION_RECORDING_RETENTION_DAYS must be a positive safe integer");
  }

  return { sessionRecordingRetentionDays };
}
