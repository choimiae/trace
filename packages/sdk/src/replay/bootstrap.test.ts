// 리플레이 번들의 **부트스트랩 자체**를 실행해 본다.
//
// index.test.ts 와 index.integration.test.ts 는 `startReplay` 를 직접 부르고,
// index.test.ts(SDK 루트)의 deny 테스트는 `window.__traceReplayStop` 을 손으로
// 심는다. 그래서 부트스트랩이 정리 함수를 window 에 남기는 **그 한 줄**을
// 실행하는 테스트가 한 건도 없었다 - 그 줄이 사라지면 consent.deny() 가 아무것도
// 멈추지 못하는데 전체 스위트는 초록인 채다. 이 계획이 반복해서 물린 모양이다.
//
// 동시에 "두 번째 실행은 아무 일도 하지 않는다" 를 본다. 이미 내려받기 시작한
// <script> 는 DOM 에서 떼어도 실행이 취소되지 않으므로, deny() 직후의 grant()
// 에서는 늦게 도착한 앞 스크립트와 새로 주입한 스크립트가 **둘 다** 실행된다.
// 뒤에 실행된 쪽이 __traceReplayStop 을 덮으면 앞 기록기의 정리 함수가 영영
// 닿지 않게 되고, 그 고아 기록기는 자기 pagehide keepalive 와 seq 0 부터 다시
// 시작하는 업로더를 그대로 들고 있다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopReplay } from "../replay-loader.js";

// 인자를 받는 것으로 선언해 둔다 - 무인자로 추론되면 tsc 가 깨진다.
const record = vi.fn((_options: unknown) => () => {});
vi.mock("rrweb", () => ({ record: (...args: unknown[]) => record(...(args as [unknown])) }));

const BOOT = {
  projectId: "proj_1",
  sessionId: "sess_1",
  endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
  maskSelectors: [],
};

/** 번들이 한 번 더 내려와 실행되는 것을 흉내 낸다. */
async function runBootstrap(): Promise<void> {
  vi.resetModules();
  await import("./index.js");
}

describe("리플레이 번들 부트스트랩", () => {
  beforeEach(() => {
    record.mockClear();
    delete window.__traceReplay;
    delete window.__traceReplayStop;
  });

  afterEach(() => {
    window.__traceReplayStop?.();
    delete window.__traceReplay;
    delete window.__traceReplayStop;
    document.body.innerHTML = "";
  });

  // 기본 번들은 이 번들을 import 할 수 없다. consent.deny() 가 기록을 멈출
  // 다리가 이 전역 하나뿐이라, 이 단언이 그 다리를 지킨다.
  it("부트 설정이 있으면 기록을 시작하고 정리 함수를 window 에 남긴다", async () => {
    window.__traceReplay = { ...BOOT };

    await runBootstrap();

    expect(record).toHaveBeenCalledTimes(1);
    expect(typeof window.__traceReplayStop).toBe("function");
  });

  it("부트 설정이 없으면 시작하지 않는다", async () => {
    await runBootstrap();

    expect(record).not.toHaveBeenCalled();
    expect(window.__traceReplayStop).toBeUndefined();
  });

  // stopReplay 가 부트 설정을 먼저 지우는 이유다 - 내려받는 중이던 번들이
  // 뒤늦게 실행돼도 읽을 것이 없으면 시작하지 않는다.
  it("deny 가 부트 설정을 지운 뒤 도착한 스크립트는 시작하지 않는다", async () => {
    await runBootstrap();

    expect(record).not.toHaveBeenCalled();
    expect(window.__traceReplayStop).toBeUndefined();
  });

  // deny() → grant() 사이에 실제로 일어나는 순서다. 앞 스크립트가 늦게 도착해
  // 기록을 시작하고, 뒤이어 새로 주입한 스크립트가 실행된다. 뒤엣것이 그대로
  // 시작하면 정리 함수가 덮여 앞 기록기를 멈출 방법이 사라진다 - 동의를
  // 철회해도 계속 올라가는, 1번 결함과 같은 종류의 조용한 실패다.
  it("이미 기록기가 돌고 있으면 두 번째 실행은 아무것도 하지 않는다", async () => {
    window.__traceReplay = { ...BOOT };
    await runBootstrap();
    const first = window.__traceReplayStop;

    // 늦게 도착한 두 번째 스크립트. 부트 설정은 grant() 가 다시 심어 둔 상태다.
    await runBootstrap();

    expect(record).toHaveBeenCalledTimes(1);
    expect(window.__traceReplayStop).toBe(first);
  });

  // 가드가 정당한 재시작까지 막으면 안 된다. 그것이 성립하는 이유는 stopReplay 가
  // __traceReplayStop 을 **지운 뒤에** 표식을 걷기 때문이다 - 두 모듈 사이의
  // 순서 약속이라, 여기서 진짜 stopReplay 를 불러 함께 못박는다. 순서가 뒤집히면
  // 동의를 다시 받아도 기록이 영영 시작되지 않는데 그것도 조용한 실패다.
  it("deny 로 멈춘 뒤 다시 주입된 스크립트는 정상적으로 시작한다", async () => {
    window.__traceReplay = { ...BOOT };
    await runBootstrap();

    // consent.deny() 가 부르는 바로 그 함수.
    stopReplay();
    // grant() 뒤 loadReplay 가 부트 설정을 다시 심고 스크립트를 다시 붙인다.
    window.__traceReplay = { ...BOOT };
    await runBootstrap();

    expect(record).toHaveBeenCalledTimes(2);
    expect(typeof window.__traceReplayStop).toBe("function");
  });
});
