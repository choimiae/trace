import { afterEach, describe, expect, it, vi } from "vitest";
import { loadReplay, stopReplay } from "./replay-loader.js";

const ENDPOINT = "https://trace.example.com/v1/events/batch";
// 이 파일의 기존 테스트는 동의가 있는 경우를 본다. 동의 게이트 자체는 아래
// "동의 게이트" 블록에서 따로 확인한다.
const GRANTED = () => true;

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
      isGranted: GRANTED,
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
      isGranted: GRANTED,
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
      isGranted: GRANTED,
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
      loadReplay({
        projectId: "proj_1",
        sessionId: "sess_1",
        endpoint: ENDPOINT,
        isGranted: GRANTED,
        fetcher: fetcher as never,
      }),
    ).resolves.toBe(false);
  });

  // 두 번째 주입은 rrweb 기록기·업로드 타이머·DOM 리스너를 통째로 하나 더 만든다.
  // SPA 가 라우트마다 init 을 부르거나 trace.js 태그가 둘이면 실제로 일어난다.
  it("이미 주입돼 있으면 두 번째 호출은 설정조차 받지 않는다", async () => {
    const fetcher = configResponse({ replay: true, maskSelectors: [] });
    const options = { projectId: "proj_1", sessionId: "sess_1", endpoint: ENDPOINT, isGranted: GRANTED, fetcher };

    expect(await loadReplay(options)).toBe(true);
    expect(await loadReplay(options)).toBe(false);

    expect(replayScripts()).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // 모듈 인스턴스가 둘이어도(스크립트 태그 두 개) 문서는 하나다. 그래서 표식을
  // 문서에서 찾는다 - 모듈 변수였다면 이 경우를 놓친다.
  it("다른 로더가 붙여 둔 스크립트도 알아본다", async () => {
    const injected = document.createElement("script");
    injected.src = "https://trace.example.com/trace-replay.js";
    injected.dataset.traceReplay = "";
    document.head.appendChild(injected);

    const fetcher = configResponse({ replay: true, maskSelectors: [] });
    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      isGranted: GRANTED,
      fetcher,
    });

    expect(started).toBe(false);
    expect(replayScripts()).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("본문이 JSON 이 아니어도 조용히 멈춘다", async () => {
    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      isGranted: GRANTED,
      fetcher: vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      })),
    });

    expect(started).toBe(false);
    expect(replayScripts()).toHaveLength(0);
    expect(window.__traceReplay).toBeUndefined();
  });

  it("셀렉터가 배열이 아니면 빈 목록으로 둔다", async () => {
    await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      isGranted: GRANTED,
      fetcher: configResponse({ replay: true, maskSelectors: "전부" }),
    });

    expect(window.__traceReplay?.maskSelectors).toEqual([]);
  });
});

describe("loadReplay 의 동의 게이트", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    delete window.__traceReplay;
    delete window.__traceReplayStop;
  });

  it("동의가 없으면 설정 요청조차 보내지 않는다", async () => {
    const fetcher = configResponse({ replay: true, maskSelectors: [] });

    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      isGranted: () => false,
      fetcher,
    });

    expect(started).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(replayScripts()).toHaveLength(0);
    expect(window.__traceReplay).toBeUndefined();
  });

  // 설정이 돌아오는 사이 배너에서 거절을 누르는 것은 평범한 순서다. 첫 검사만
  // 두면 그 요청이 그대로 기록을 시작시킨다.
  it("설정을 기다리는 사이 철회하면 주입하지 않는다", async () => {
    let granted = true;
    const fetcher = vi.fn(async () => {
      granted = false;
      return { ok: true, json: async () => ({ replay: true, maskSelectors: [] }) };
    });

    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      isGranted: () => granted,
      fetcher,
    });

    expect(started).toBe(false);
    expect(replayScripts()).toHaveLength(0);
    expect(window.__traceReplay).toBeUndefined();
  });
});

describe("stopReplay", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    delete window.__traceReplay;
    delete window.__traceReplayStop;
  });

  it("기록기를 멈추고 부트 설정과 표식을 걷는다", async () => {
    await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      isGranted: GRANTED,
      fetcher: configResponse({ replay: true, maskSelectors: [] }),
    });
    const stop = vi.fn();
    window.__traceReplayStop = stop;

    stopReplay();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(window.__traceReplay).toBeUndefined();
    expect(window.__traceReplayStop).toBeUndefined();
    expect(replayScripts()).toHaveLength(0);
  });

  // 표식이 남아 있으면 loadReplay 가 "이미 붙어 있다" 로 보고 영영 시작하지 않는다.
  it("멈춘 뒤에 다시 동의하면 다시 주입한다", async () => {
    const options = {
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      isGranted: GRANTED,
      fetcher: configResponse({ replay: true, maskSelectors: [] }),
    };
    await loadReplay(options);
    stopReplay();

    expect(await loadReplay(options)).toBe(true);
    expect(replayScripts()).toHaveLength(1);
  });

  it("정리 함수가 던져도 고객 사이트로 흘리지 않는다", () => {
    window.__traceReplayStop = () => {
      throw new Error("기록기가 이미 죽었다");
    };

    expect(() => stopReplay()).not.toThrow();
  });
});
