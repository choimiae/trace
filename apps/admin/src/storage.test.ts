import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPreviewLabels,
  readSelectedProjectId,
  writePreviewLabels,
  writeSelectedProjectId,
} from "./storage.js";

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

describe("미리보기 글자 보기 저장", () => {
  it("켠 상태를 저장하고 읽는다", () => {
    writePreviewLabels(true);

    expect(readPreviewLabels()).toBe(true);
  });

  it("끈 상태를 저장하고 읽는다", () => {
    writePreviewLabels(true);
    writePreviewLabels(false);

    expect(readPreviewLabels()).toBe(false);
  });

  // 기본은 꺼짐이다. 저장된 값이 없을 때 켜진 채로 열리면 화면의 글자가
  // 운영자가 고르지 않았는데 드러난다.
  it("저장된 값이 없으면 꺼짐이다", () => {
    expect(readPreviewLabels()).toBe(false);
  });

  it("localStorage 접근이 실패해도 꺼짐으로 동작한다", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => writePreviewLabels(true)).not.toThrow();
    expect(readPreviewLabels()).toBe(false);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
