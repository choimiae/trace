import { describe, expect, it, vi } from "vitest";
import { autoInstall, readInstallOptions } from "./install.js";

function createScript(attributes: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  return script;
}

describe("readInstallOptions", () => {
  it("스크립트 src origin 에서 수집 엔드포인트를 유추한다", () => {
    const script = createScript({
      src: "https://trace.example.com/trace.js",
      "data-project-id": "proj_abc",
    });

    expect(readInstallOptions(script)).toEqual({
      projectId: "proj_abc",
      endpoint: "https://trace.example.com/v1/events/batch",
      consent: "granted",
    });
  });

  it("경로가 있는 src 에서도 origin 기준으로 엔드포인트를 만든다", () => {
    const script = createScript({
      src: "https://trace.example.com/static/js/trace.js",
      "data-project-id": "proj_abc",
    });

    expect(readInstallOptions(script)?.endpoint).toBe("https://trace.example.com/v1/events/batch");
  });

  it("data-endpoint 가 있으면 유추값을 덮어쓴다", () => {
    const script = createScript({
      src: "https://cdn.example.com/trace.js",
      "data-project-id": "proj_abc",
      "data-endpoint": "https://collector.example.com/v1/events/batch",
    });

    expect(readInstallOptions(script)?.endpoint).toBe("https://collector.example.com/v1/events/batch");
  });

  it("data-consent 로 수집을 보류할 수 있다", () => {
    const script = createScript({
      src: "https://trace.example.com/trace.js",
      "data-project-id": "proj_abc",
      "data-consent": "pending",
    });

    expect(readInstallOptions(script)?.consent).toBe("pending");
  });

  it("알 수 없는 data-consent 값은 granted 로 처리한다", () => {
    const script = createScript({
      src: "https://trace.example.com/trace.js",
      "data-project-id": "proj_abc",
      "data-consent": "maybe",
    });

    expect(readInstallOptions(script)?.consent).toBe("granted");
  });

  it("data-project-id 가 없으면 undefined 를 반환한다", () => {
    const script = createScript({ src: "https://trace.example.com/trace.js" });

    expect(readInstallOptions(script)).toBeUndefined();
  });

  it("script 요소가 없으면 undefined 를 반환한다", () => {
    expect(readInstallOptions(null)).toBeUndefined();
  });
});

describe("autoInstall", () => {
  it("옵션이 유효하면 start 를 호출한다", () => {
    const start = vi.fn();
    const script = createScript({
      src: "https://trace.example.com/trace.js",
      "data-project-id": "proj_abc",
    });

    autoInstall(script, start);

    expect(start).toHaveBeenCalledWith({
      projectId: "proj_abc",
      endpoint: "https://trace.example.com/v1/events/batch",
      consent: "granted",
    });
  });

  it("data-project-id 가 없으면 start 를 부르지 않고 경고를 남긴다", () => {
    const start = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const script = createScript({ src: "https://trace.example.com/trace.js" });

    autoInstall(script, start);

    expect(start).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("script 요소가 없으면 경고 없이 아무것도 하지 않는다", () => {
    const start = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    autoInstall(null, start);

    expect(start).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
