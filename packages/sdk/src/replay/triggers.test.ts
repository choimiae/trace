import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTriggers, type TriggerHandle, type TriggerReason } from "./triggers.js";

function setup() {
  const reasons: TriggerReason[] = [];
  const handle = installTriggers(window, { onTrigger: (reason) => reasons.push(reason) });
  return { reasons, handle };
}

function clickOn(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("installTriggers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("같은 요소를 3초 안에 세 번 누르면 분노 클릭이다", () => {
    const { reasons, handle } = setup();
    const button = document.querySelector("#a")!;

    clickOn(button);
    handle.notifyMutation();
    clickOn(button);
    handle.notifyMutation();
    clickOn(button);
    handle.notifyMutation();

    expect(reasons).toContain("rage_click");
    handle.dispose();
  });

  it("3초를 넘겨 누르면 분노 클릭이 아니다", () => {
    const { reasons, handle } = setup();
    const button = document.querySelector("#a")!;

    clickOn(button);
    handle.notifyMutation();
    vi.advanceTimersByTime(4000);
    clickOn(button);
    handle.notifyMutation();
    vi.advanceTimersByTime(4000);
    clickOn(button);
    handle.notifyMutation();

    expect(reasons).not.toContain("rage_click");
    handle.dispose();
  });

  it("다른 요소를 누르면 연속 횟수가 초기화된다", () => {
    const { reasons, handle } = setup();

    clickOn(document.querySelector("#a")!);
    handle.notifyMutation();
    clickOn(document.querySelector("#a")!);
    handle.notifyMutation();
    clickOn(document.querySelector("#b")!);
    handle.notifyMutation();
    clickOn(document.querySelector("#a")!);
    handle.notifyMutation();

    expect(reasons).not.toContain("rage_click");
    handle.dispose();
  });

  it("클릭 뒤 2초간 DOM 변경이 없으면 반응 없는 클릭이다", () => {
    const { reasons, handle } = setup();

    clickOn(document.querySelector("#a")!);
    vi.advanceTimersByTime(2000);

    expect(reasons).toEqual(["dead_click"]);
    handle.dispose();
  });

  it("2초 안에 DOM 이 바뀌면 반응 없는 클릭이 아니다", () => {
    const { reasons, handle } = setup();

    clickOn(document.querySelector("#a")!);
    vi.advanceTimersByTime(500);
    handle.notifyMutation();
    vi.advanceTimersByTime(2000);

    expect(reasons).not.toContain("dead_click");
    handle.dispose();
  });

  it("오류가 나면 바로 트리거한다", () => {
    const { reasons, handle } = setup();

    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));

    expect(reasons).toEqual(["js_error"]);
    handle.dispose();
  });

  it("dispose 뒤에는 아무것도 트리거하지 않는다", () => {
    const { reasons, handle } = setup();
    handle.dispose();

    clickOn(document.querySelector("#a")!);
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));

    expect(reasons).toEqual([]);
  });

  it("dispose() 는 마지막으로 클릭한 요소에 대한 참조를 놓는다", async () => {
    const { handle } = setup();

    let button: HTMLButtonElement | null = document.createElement("button");
    document.body.appendChild(button);
    clickOn(button);

    const ref = new WeakRef(button);
    button.remove();
    button = null;

    handle.dispose();

    // 이 환경에는 --expose-gc 플래그가 없다. v8.setFlagsFromString 으로
    // 런타임에 켜고 새 vm 컨텍스트에서 gc 를 뽑아 강제로 전체 GC 를 돌린다 -
    // 실제 참조 해제 여부를 확인하는 유일한 방법이라 시간 대기가 아니다.
    const v8 = await import("node:v8");
    const vm = await import("node:vm");
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    gc();
    gc();

    expect(ref.deref()).toBeUndefined();
  });

  it("다른 요소를 눌러도 이전 요소의 반응 없는 클릭 판정은 취소되지 않는다", () => {
    const { reasons, handle } = setup();

    clickOn(document.querySelector("#a")!);
    vi.advanceTimersByTime(500);
    clickOn(document.querySelector("#b")!); // A 의 대기를 건드리면 안 된다
    vi.advanceTimersByTime(1500); // A 의 클릭으로부터 2000ms 경과

    expect(reasons).toEqual(["dead_click"]); // A: 반응 없음

    vi.advanceTimersByTime(500); // B 의 클릭으로부터 2000ms 경과

    expect(reasons).toEqual(["dead_click", "dead_click"]); // B 도 반응 없음

    handle.dispose();
  });

  it("onTrigger 안에서 dispose() 를 불러도 반응 없는 클릭 타이머가 새로 걸리지 않는다", () => {
    let handle!: TriggerHandle;
    const reasons: TriggerReason[] = [];
    handle = installTriggers(window, {
      onTrigger: (reason) => {
        reasons.push(reason);
        if (reason === "rage_click") handle.dispose();
      },
    });

    const button = document.querySelector("#a")!;
    clickOn(button);
    clickOn(button);
    clickOn(button); // 세 번째에서 rage_click 이 불이 붙고, 콜백 안에서 dispose() 된다

    expect(reasons).toEqual(["rage_click"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
