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
