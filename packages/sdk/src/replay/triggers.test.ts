import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTriggers, type TriggerReason } from "./triggers.js";

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
});
