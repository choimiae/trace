import { afterEach, describe, expect, it, vi } from "vitest";
import { consent, init } from "./index.js";

const ENDPOINT = "https://trace.example.com/v1/events/batch";
const CONFIG_URL = "https://trace.example.com/v1/projects/proj_1/config";

/**
 * 리플레이 설정 응답을 흉내 낸다. `client.flush()` 도 같은 전역 fetch 를 쓰므로
 * "불렸나" 가 아니라 **설정 URL 로 불렸나** 를 본다.
 */
function stubFetch() {
  // 인자를 받는 것으로 선언해 둔다. `vi.fn(async () => …)` 로 두면 호출
  // 시그니처가 무인자로 추론되어 `call[0]` 이 tsc 에서 깨진다(빌드가 테스트
  // 파일까지 타입 검사한다).
  const fetcher = vi.fn(async (_input: string, _init?: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ replay: true, maskSelectors: [] }),
  }));
  vi.stubGlobal("fetch", fetcher);
  return {
    fetcher,
    configRequests: () => fetcher.mock.calls.filter((call) => call[0] === CONFIG_URL),
  };
}

function replayScripts(): Element[] {
  return Array.from(document.querySelectorAll("script[data-trace-replay]"));
}

/** loadReplay 는 fetch → json 두 단계를 기다린다. 매크로태스크 한 번이면 충분하다. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("init 의 동의 게이트", () => {
  afterEach(() => {
    consent.deny();
    document.head.innerHTML = "";
    delete window.__traceReplay;
    delete window.__traceReplayStop;
    vi.unstubAllGlobals();
  });

  // 가장 크게 수집하는 경로가 동의를 건너뛰고 있었다. data-consent="pending" 은
  // README 가 동의 배너 지역에 권하는 바로 그 설정인데, 평범한 이벤트는 한 건도
  // 나가지 않는 동안 리플레이는 설정을 받고 rrweb 을 켜 첫 트리거에 DOM 스냅샷을
  // 통째로 올렸다.
  it("동의가 보류면 설정조차 받지 않는다", async () => {
    const { configRequests } = stubFetch();

    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "pending" });
    await settle();

    expect(configRequests()).toHaveLength(0);
    expect(window.__traceReplay).toBeUndefined();
    expect(replayScripts()).toHaveLength(0);
  });

  it("동의를 거절하면 설정조차 받지 않는다", async () => {
    const { configRequests } = stubFetch();

    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "denied" });
    await settle();

    expect(configRequests()).toHaveLength(0);
    expect(window.__traceReplay).toBeUndefined();
    expect(replayScripts()).toHaveLength(0);
  });

  it("동의가 있으면 평소처럼 리플레이를 주입한다", async () => {
    const { configRequests } = stubFetch();

    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" });
    await settle();

    expect(configRequests()).toHaveLength(1);
    expect(replayScripts()).toHaveLength(1);
  });

  // 배너에서 늦게 동의를 받는 것이 data-consent="pending" 의 존재 이유다.
  // grant() 가 리플레이를 켜지 못하면 그 지역에서는 기능이 영영 꺼진 셈이다.
  it("나중에 동의하면 그때 리플레이를 시작한다", async () => {
    const { configRequests } = stubFetch();
    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "pending" });
    await settle();

    consent.grant();
    await settle();

    expect(configRequests()).toHaveLength(1);
    expect(replayScripts()).toHaveLength(1);
    expect(window.__traceReplay?.projectId).toBe("proj_1");
  });

  // deny() 가 이벤트 큐만 비우고 기록기를 그대로 두면, 동의를 철회한 사용자의
  // 화면이 계속 버퍼에 담기고 다음 트리거에 그대로 올라간다.
  it("동의를 철회하면 돌고 있던 기록기를 멈춘다", async () => {
    stubFetch();
    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" });
    await settle();
    // 리플레이 번들이 시작하면서 남기는 정리 함수를 흉내 낸다.
    const stop = vi.fn();
    window.__traceReplayStop = stop;

    consent.deny();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(window.__traceReplay).toBeUndefined();
    expect(window.__traceReplayStop).toBeUndefined();
    // 표식이 남아 있으면 다음 grant() 가 다시 주입하지 못한다.
    expect(replayScripts()).toHaveLength(0);
  });

  // 설정을 기다리는 동안 사용자가 배너에서 거절을 누르는 것은 평범한 순서다.
  it("설정을 기다리는 사이 거절하면 주입하지 않는다", async () => {
    stubFetch();

    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" });
    consent.deny();
    await settle();

    expect(window.__traceReplay).toBeUndefined();
    expect(replayScripts()).toHaveLength(0);
  });
});
