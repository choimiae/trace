import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceClient } from "./client.js";
import { installCollectors } from "./collectors.js";

let captured: Array<{ type: string; urlPath: string; metadata: Record<string, unknown> }> = [];

function queuedTypes(): string[] {
  // enqueue 를 가로채 큐를 직접 본다. flush 는 전송까지 가므로 여기서는 쓰지 않는다.
  return captured.map((event) => event.type);
}

function makeClient(): TraceClient {
  const client = new TraceClient({
    projectId: "proj_1",
    endpoint: "https://trace.example.com/v1/events/batch",
    consent: "granted",
  });
  vi.spyOn(client, "enqueue").mockImplementation((event) => {
    captured.push(event as never);
  });
  return client;
}

beforeEach(() => {
  captured = [];
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("installCollectors", () => {
  it("시작할 때 page_view 를 한 번 보낸다", () => {
    installCollectors(makeClient());

    expect(queuedTypes()).toEqual(["page_view"]);
  });

  it("라우팅하면 직전 페이지의 page_leave 를 먼저, 새 page_view 를 다음에 보낸다", () => {
    installCollectors(makeClient());
    captured = [];

    window.history.pushState(null, "", "/settings");

    expect(captured.map((event) => [event.type, event.urlPath])).toEqual([
      ["page_leave", "/"],
      ["page_view", "/settings"],
    ]);
  });

  it("떠날 때 page_leave 를 보낸다", () => {
    installCollectors(makeClient());
    captured = [];

    window.dispatchEvent(new Event("pagehide"));

    expect(captured.map((event) => event.type)).toEqual(["page_leave"]);
  });

  it("스크롤 마일스톤을 metadata 의 metric·score 로 담는다", () => {
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    installCollectors(makeClient());
    captured = [];

    window.dispatchEvent(new Event("scroll"));

    expect(captured.map((event) => [event.type, event.metadata])).toEqual([
      ["scroll", { metric: "scroll_depth", score: 25 }],
      ["scroll", { metric: "scroll_depth", score: 50 }],
    ]);
  });

  it("라우팅하면 스크롤 마일스톤이 초기화된다", () => {
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    installCollectors(makeClient());
    window.dispatchEvent(new Event("scroll"));
    window.history.pushState(null, "", "/settings");
    captured = [];

    window.dispatchEvent(new Event("scroll"));

    expect(captured.map((event) => event.metadata)).toEqual([
      { metric: "scroll_depth", score: 25 },
      { metric: "scroll_depth", score: 50 },
    ]);
  });
});
