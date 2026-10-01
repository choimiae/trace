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

  it("클릭 이벤트에 화면 맥락을 싣지 않는다", () => {
    document.body.innerHTML = '<main><button id="save">저장</button></main>';
    installCollectors(makeClient());
    captured = [];

    document.querySelector("#save")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const click = captured.find((event) => event.type === "click");
    expect(click).toBeDefined();
    expect(click).not.toHaveProperty("screenContext");
  });

  it("JS 오류를 수집하지 않는다", () => {
    installCollectors(makeClient());
    captured = [];

    // jsdom 은 처리되지 않은 error 를 테스트 러너에 uncaught 로 보고한다. 기본 동작을 막는다.
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener("error", swallow);
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("x"),
        filename: "https://app.example.com/a.js",
        lineno: 3,
        cancelable: true,
      }),
    );
    window.removeEventListener("error", swallow);

    expect(captured.some((event) => event.type === "js_error")).toBe(false);
  });
});

describe("page_view 제목", () => {
  afterEach(() => {
    document.title = "";
  });

  function pageViewTitles(): Array<string | undefined> {
    return captured
      .filter((event) => event.type === "page_view")
      .map((event) => (event as { titleMasked?: string }).titleMasked);
  }

  it("화면 제목을 마스킹해 page_view 에 싣는다", () => {
    document.title = "고객 choi@example.com 상세";

    installCollectors(makeClient());

    expect(pageViewTitles()).toEqual(["고객 [redacted] 상세"]);
  });

  // 계약은 빈 문자열을 막지 않지만 집계는 "제목이 없으면 경로" 로 물러선다.
  // 빈 문자열이 들어가면 그 화면 이름이 빈칸이 된다.
  it("제목이 비어 있으면 titleMasked 를 넣지 않는다", () => {
    document.title = "   ";

    installCollectors(makeClient());

    expect(captured[0]).not.toHaveProperty("titleMasked");
  });

  it("라우팅 뒤에 바뀐 제목을 아직 나가지 않은 page_view 에 덮어 준다", async () => {
    document.title = "대시보드";
    installCollectors(makeClient());

    // SPA 라우터의 순서다: 경로를 먼저 바꾸고, 렌더 뒤에 제목을 바꾼다.
    window.history.pushState({}, "", "/billing");
    document.title = "청구";
    // MutationObserver 콜백은 마이크로태스크로 온다.
    await Promise.resolve();

    expect(pageViewTitles()).toEqual(["대시보드", "청구"]);
  });

  it("제목이 비워지면 덮어 둔 제목도 지운다", async () => {
    document.title = "대시보드";
    installCollectors(makeClient());

    document.title = "";
    await Promise.resolve();

    expect(captured[0]).not.toHaveProperty("titleMasked");
  });
});
