import { afterEach, describe, expect, it, vi } from "vitest";
import { loadReplay } from "./replay-loader.js";

const ENDPOINT = "https://trace.example.com/v1/events/batch";

function configResponse(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }));
}

function replayScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll("script[src]"));
}

describe("loadReplay", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    delete window.__traceReplay;
  });

  it("리플레이가 켜져 있으면 설정을 심고 스크립트를 붙인다", async () => {
    const fetcher = configResponse({ replay: true, maskSelectors: [".customer-name"] });

    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      fetcher,
    });

    expect(started).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("https://trace.example.com/v1/projects/proj_1/config");
    expect(window.__traceReplay).toEqual({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
      maskSelectors: [".customer-name"],
    });
    expect(replayScripts()[0]!.src).toBe("https://trace.example.com/trace-replay.js");
  });

  // 켜지 않은 프로젝트는 rrweb 44 KB 를 내려받을 이유가 없다.
  it("꺼져 있으면 리플레이 번들을 내려받지 않는다", async () => {
    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      fetcher: configResponse({ replay: false, maskSelectors: [] }),
    });

    expect(started).toBe(false);
    expect(replayScripts()).toHaveLength(0);
    expect(window.__traceReplay).toBeUndefined();
  });

  // 설정을 못 받았는데 기록을 시작하면 가려야 할 자리가 원문으로 담긴다.
  // 번들 자체를 내려받지 않으므로 구조적으로 시작될 수 없다.
  it("설정을 못 받으면 아무것도 시작하지 않는다", async () => {
    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      fetcher: configResponse({}, false),
    });

    expect(started).toBe(false);
    expect(replayScripts()).toHaveLength(0);
  });

  it("네트워크가 던져도 고객 사이트로 오류를 흘리지 않는다", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(
      loadReplay({ projectId: "proj_1", sessionId: "sess_1", endpoint: ENDPOINT, fetcher: fetcher as never }),
    ).resolves.toBe(false);
  });

  it("셀렉터가 배열이 아니면 빈 목록으로 둔다", async () => {
    await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      fetcher: configResponse({ replay: true, maskSelectors: "전부" }),
    });

    expect(window.__traceReplay?.maskSelectors).toEqual([]);
  });
});
