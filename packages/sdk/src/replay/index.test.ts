import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKPOINT_INTERVAL_MS } from "@trace/shared/recording-limits";

// 인자를 받는 것으로 선언해 둔다. `vi.fn(() => …)` 로 두면 호출 시그니처가
// 무인자로 추론되어 `record.mock.calls[0]![0]` 이 tsc 에서 깨진다(빌드가
// 테스트 파일까지 타입 검사한다).
const record = vi.fn((_options: unknown) => () => {});
vi.mock("rrweb", () => ({ record: (...args: unknown[]) => record(...(args as [unknown])) }));

const { startReplay: start } = await import("./index.js");

// startReplay 는 window 에 리스너를 단다. 테스트마다 정리하지 않으면 앞 테스트의
// pagehide 리스너·타이머가 뒤 테스트에 섞이지 않게 한다.
const stops: Array<() => void> = [];
const startReplay: typeof start = (...args) => {
  const stop = start(...args);
  stops.push(stop);
  return stop;
};

describe("startReplay", () => {
  beforeEach(() => {
    record.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    while (stops.length > 0) stops.pop()!();
    document.body.innerHTML = "";
  });

  const config = {
    projectId: "proj_1",
    sessionId: "sess_1",
    endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
    maskSelectors: [".customer-name", "td.amount"],
  };

  it("운영자 셀렉터를 maskTextSelector 로 넘긴다", () => {
    startReplay(config);

    const options = record.mock.calls[0]![0] as { maskTextSelector?: string };
    expect(options.maskTextSelector).toBe("textarea,.customer-name,td.amount");
  });

  // textarea 는 운영자가 지정하지 않아도 언제나 들어간다. rrweb 이 textarea 의
  // 값을 attributes.value 로만 가리고 HTML 에 적혀 온 초기 내용은 자식 텍스트
  // 노드로 따로 실어 보내기 때문이다 - 운영자가 매번 적어야 하는 종류의 것이
  // 아니다.
  //
  // 그래서 이 값은 비지 않고, 조건부 전개도 사라졌다. 빈 문자열이 위험해서가
  // 아니다 - needMaskingText 는 `if (maskTextSelector)` 로 감싸 두어서 빈
  // 문자열에는 아무 일도 일어나지 않는다. 위험한 것은 비어 있지 않은 **잘못된**
  // 셀렉터이고("textarea," 처럼), 그때는 스냅샷이 통째로 죽는다.
  it("셀렉터가 없어도 textarea 는 언제나 가린다", () => {
    startReplay({ ...config, maskSelectors: [] });

    const options = record.mock.calls[0]![0] as { maskTextSelector?: string };
    expect(options.maskTextSelector).toBe("textarea");
  });

  // 관리자 검증을 통과하고도 CSS 파서가 던지는 문자열이 있다. 그런 항목 하나가
  // 섞이면 needMaskingText 의 closest 가 모든 텍스트 노드에서 SyntaxError 를
  // 내고 기록이 통째로 죽는다 - 그러면 남은 멀쩡한 셀렉터도 아무것도 가리지
  // 못한다. 하나를 버리고 나머지를 살린다.
  it("컴파일되지 않는 운영자 셀렉터를 버리고 나머지를 쓴다", () => {
    startReplay({ ...config, maskSelectors: [".customer-name,", "td.amount", ".foo)", "]", ""] });

    const options = record.mock.calls[0]![0] as { maskTextSelector?: string };
    expect(options.maskTextSelector).toBe("textarea,td.amount");
  });

  // 전부 버려져도 textarea 는 남아야 한다. 빈 문자열이 되면 rrweb 이
  // `if (maskTextSelector)` 에서 거짓으로 보고 마스킹 게이트를 통째로 연다.
  it("운영자 셀렉터가 전부 버려져도 textarea 는 남는다", () => {
    startReplay({ ...config, maskSelectors: [".customer-name,"] });

    const options = record.mock.calls[0]![0] as { maskTextSelector?: string };
    expect(options.maskTextSelector).toBe("textarea");
  });

  it("비용이 큰 수집을 모두 끈다", () => {
    startReplay(config);

    expect(record.mock.calls[0]![0]).toMatchObject({
      // maskAllInputs: true 가 아니라 명시 집합이다 - 그 플래그가 펼치는 집합에는
      // "input" 태그명 키가 없어 type 속성이 없거나 hidden 이거나 대문자인
      // input 의 값이 스냅샷에 그대로 실렸다. 태그명 키 하나가 스냅샷·관찰자
      // 두 게이트를 함께 닫는다.
      maskInputOptions: { input: true, textarea: true, select: true, password: true },
      inlineStylesheet: false,
      recordCanvas: false,
      collectFonts: false,
      inlineImages: false,
      checkoutEveryNms: CHECKPOINT_INTERVAL_MS,
    });
  });

  it("emit 이 data: URI 를 걷어낸다", () => {
    startReplay(config);
    const emit = (record.mock.calls[0]![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;

    const snapshot = {
      type: 2,
      timestamp: 1,
      data: { node: { tagName: "img", attributes: { src: "data:image/png;base64,AAAA" } } },
    };
    emit(snapshot, true);

    expect(snapshot.data.node.attributes.src).not.toContain("base64,AAAA");
  });

  it("트리거 없이도 주기마다 기록을 올린다", () => {
    vi.useFakeTimers();
    const uploader = { enqueue: vi.fn(), flush: vi.fn(async () => true) };
    startReplay(config, { uploader });
    const emit = (record.mock.calls[0]![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;

    emit({ type: 4, timestamp: 1, data: {} });
    emit({ type: 2, timestamp: 2, data: {} }, true);
    vi.advanceTimersByTime(10_000);

    expect(uploader.enqueue).toHaveBeenCalledTimes(1);
    expect(uploader.enqueue.mock.calls[0]![0]).toHaveLength(2);
    expect(uploader.flush).toHaveBeenCalledTimes(1);
  });

  it("페이지를 떠날 때 남은 기록을 keepalive 로 올린다", () => {
    const uploader = { enqueue: vi.fn(), flush: vi.fn(async () => true) };
    startReplay(config, { uploader });
    const emit = (record.mock.calls[0]![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;

    emit({ type: 2, timestamp: 1, data: {} }, true);
    window.dispatchEvent(new Event("pagehide"));

    expect(uploader.enqueue).toHaveBeenCalledWith([expect.objectContaining({ timestamp: 1 })]);
    expect(uploader.flush).toHaveBeenLastCalledWith({ keepalive: true });
  });
});
