import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter } from "./rate-limit.js";

describe("fixed window rate limiter", () => {
  it("rejects requests above the configured window max", () => {
    const limiter = createFixedWindowRateLimiter({ windowMs: 1000, max: 2 });

    expect(limiter.consume("ip_1", 0)).toBe(true);
    expect(limiter.consume("ip_1", 10)).toBe(true);
    expect(limiter.consume("ip_1", 20)).toBe(false);
    expect(limiter.consume("ip_1", 1001)).toBe(true);
  });
});
