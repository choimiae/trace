interface FixedWindowRateLimiterOptions {
  windowMs: number;
  max: number;
}

export function createFixedWindowRateLimiter(options: FixedWindowRateLimiterOptions): {
  consume(key: string, nowMs?: number): boolean;
} {
  const counters = new Map<string, { windowStartMs: number; count: number }>();

  return {
    consume(key: string, nowMs = Date.now()): boolean {
      const windowStartMs = Math.floor(nowMs / options.windowMs) * options.windowMs;
      const counter = counters.get(key);

      if (!counter || counter.windowStartMs !== windowStartMs) {
        counters.set(key, { windowStartMs, count: 1 });
        return true;
      }

      if (counter.count >= options.max) return false;

      counter.count += 1;
      return true;
    },
  };
}
