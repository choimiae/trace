import { afterEach, describe, expect, it } from "vitest";
import { readItem, removeItem, writeItem } from "./storage.js";
import { breakStorage } from "./test-storage.js";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("storage", () => {
  it("쓰고 읽고 지운다", () => {
    expect(writeItem("session", "trace:test", "1")).toBe(true);
    expect(readItem("session", "trace:test")).toBe("1");
    removeItem("session", "trace:test");
    expect(readItem("session", "trace:test")).toBeUndefined();
  });

  it("저장소 접근이 던지면 없음으로 보고 던지지 않는다", () => {
    const restore = breakStorage("localStorage");
    try {
      expect(readItem("local", "trace:test")).toBeUndefined();
      expect(writeItem("local", "trace:test", "1")).toBe(false);
      expect(() => removeItem("local", "trace:test")).not.toThrow();
    } finally {
      restore();
    }
  });
});
