import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSelectedProjectId, writeSelectedProjectId } from "./storage.js";

beforeEach(() => {
  window.localStorage.clear();
});

describe("선택한 프로젝트 저장", () => {
  it("저장한 값을 읽는다", () => {
    writeSelectedProjectId("proj_abc");

    expect(readSelectedProjectId()).toBe("proj_abc");
  });

  it("저장된 값이 없으면 undefined 를 반환한다", () => {
    expect(readSelectedProjectId()).toBeUndefined();
  });

  it("localStorage 접근이 실패해도 예외를 던지지 않는다", () => {
    // jsdom 의 localStorage 는 Proxy 라 인스턴스에 스파이를 얹으면 defineProperty
    // 트랩이 삼켜 버린다. 실제로 가로채려면 Storage.prototype 에 걸어야 한다.
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => writeSelectedProjectId("proj_abc")).not.toThrow();
    expect(readSelectedProjectId()).toBeUndefined();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
