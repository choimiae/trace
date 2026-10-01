import { afterEach, describe, expect, it, vi } from "vitest";
import { consent, init } from "./index.js";
import { REPLAY_SEQ_KEY, SESSION_KEY, VISITOR_KEY } from "./storage.js";

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
    sessionStorage.clear();
    localStorage.clear();
  });

  // 가장 크게 수집하는 경로가 동의를 건너뛰고 있었다. data-consent="pending" 은
  // README 가 동의 배너 지역에 권하는 바로 그 설정인데, 평범한 이벤트는 한 건도
  // 나가지 않는 동안 리플레이는 설정을 받고 rrweb 을 켜 첫 업로드에 DOM 스냅샷을
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
  // 화면이 계속 기록되어 다음 10 초 업로드나 pagehide 에 그대로 올라간다.
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

describe("window.trace", () => {
  it("track 을 두지 않는다", () => {
    expect(window.trace).toBeDefined();
    expect(Object.keys(window.trace!).sort()).toEqual(["consent", "init"]);
  });
});

describe("init 의 세션 이어 가기", () => {
  afterEach(() => {
    consent.deny();
    document.head.innerHTML = "";
    delete window.__traceReplay;
    delete window.__traceReplayStop;
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  function sentBatches(fetcher: ReturnType<typeof stubFetch>["fetcher"]) {
    return fetcher.mock.calls
      .filter((call) => call[0] === ENDPOINT)
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as { sessionId: string; anonymousUserId: string });
  }

  // 새로고침은 스크립트를 처음부터 다시 실행한다. init 을 두 번 부르는 것으로 흉내 낸다.
  it("새로고침해도 같은 세션과 방문자로 보낸다", async () => {
    const { fetcher } = stubFetch();

    await init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" }).flush();
    await init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" }).flush();

    const [first, second] = sentBatches(fetcher);
    expect(second!.sessionId).toBe(first!.sessionId);
    expect(second!.anonymousUserId).toBe(first!.anonymousUserId);
  });

  it("동의 보류 중에는 저장소에 쓰지 않는다", () => {
    stubFetch();

    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "pending" });

    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
  });

  it("동의 보류에서 grant 하면 저장된 세션을 이어 받고 리플레이도 그 세션으로 올린다", async () => {
    stubFetch();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: "sess_Stored12345", lastActivityAt: Date.now() }));

    const client = init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "pending" });
    consent.grant();
    await settle();

    expect(client.sessionId).toBe("sess_Stored12345");
    expect(window.__traceReplay?.sessionId).toBe("sess_Stored12345");
    expect(window.__traceReplay?.endpoint).toBe("https://trace.example.com/v1/sessions/sess_Stored12345/recording");
  });

  it("거부하면 Trace 가 저장소에 둔 키를 지운다", () => {
    stubFetch();
    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" });
    sessionStorage.setItem(REPLAY_SEQ_KEY, JSON.stringify({ sessionId: "sess_x", next: 2 }));

    consent.deny();

    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(REPLAY_SEQ_KEY)).toBeNull();
    expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
  });
});
