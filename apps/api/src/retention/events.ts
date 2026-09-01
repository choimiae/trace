import type { TraceStore } from "../store/types.js";
import type { EventRetentionConfig } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function eventRetentionCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export async function runEventRetention(
  store: TraceStore,
  config: EventRetentionConfig,
  now: Date = new Date(),
): Promise<number> {
  if (config.eventRetentionDays === undefined) return 0;

  return store.deleteEventsBefore(eventRetentionCutoff(now, config.eventRetentionDays));
}
