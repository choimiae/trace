import { describe, expect, it } from "vitest";
import { loadEventRetentionConfig } from "./config.js";

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
