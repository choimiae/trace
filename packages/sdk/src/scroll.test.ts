import { describe, expect, it, vi } from "vitest";
import { installScrollWatcher, reachedMilestones, SCROLL_MILESTONES } from "./scroll.js";

describe("reachedMilestones", () => {
  it("넘은 구간을 모두 돌려준다", () => {
    expect(reachedMilestones(60, new Set())).toEqual([25, 50]);
  });

  it("이미 보낸 구간은 빼고 돌려준다", () => {
    expect(reachedMilestones(60, new Set([25]))).toEqual([50]);
  });

  it("되돌아 올라가면 아무것도 돌려주지 않는다", () => {
    expect(reachedMilestones(10, new Set([25, 50]))).toEqual([]);
  });

  it("끝까지 내리면 100 까지 돌려준다", () => {
    expect(reachedMilestones(100, new Set())).toEqual([...SCROLL_MILESTONES]);
  });
});

function stubDocument(documentHeight: number, viewportHeight: number, scrollTop: number) {
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(documentHeight);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(viewportHeight);
  Object.defineProperty(window, "scrollY", { value: scrollTop, configurable: true });
}

describe("installScrollWatcher", () => {
  it("구간을 넘으면 한 번씩만 알린다", () => {
    stubDocument(2000, 500, 500); // (500 + 500) / 2000 = 50%
    const onMilestone = vi.fn();
    const watcher = installScrollWatcher(window, onMilestone);

    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));

    expect(onMilestone.mock.calls.map((call) => call[0])).toEqual([25, 50]);
    watcher.dispose();
  });

  // 문서가 뷰포트보다 짧으면 스크롤이 불가능하다. 100% 를 즉시 보내면
  // "끝까지 읽었다" 와 구분되지 않는다.
  it("스크롤이 불가능한 문서는 아무것도 보내지 않는다", () => {
    stubDocument(400, 500, 0);
    const onMilestone = vi.fn();
    const watcher = installScrollWatcher(window, onMilestone);

    window.dispatchEvent(new Event("scroll"));

    expect(onMilestone).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("reset 하면 같은 구간을 다시 보낸다", () => {
    stubDocument(2000, 500, 500);
    const onMilestone = vi.fn();
    const watcher = installScrollWatcher(window, onMilestone);

    window.dispatchEvent(new Event("scroll"));
    watcher.reset();
    window.dispatchEvent(new Event("scroll"));

    expect(onMilestone.mock.calls.map((call) => call[0])).toEqual([25, 50, 25, 50]);
    watcher.dispose();
  });

  // onMilestone 은 수집 콜백이다. 하나가 던져도 같은 스크롤 이벤트 안의
  // 나머지 마일스톤은 그대로 보내야 한다 - 이번 것 하나만 버리는 것이
  // 구현의 선택이다.
  it("onMilestone 이 던져도 같은 스크롤 이벤트의 나머지 마일스톤은 그대로 보낸다", () => {
    stubDocument(2000, 500, 500); // 50%
    const onMilestone = vi.fn((percent: number) => {
      if (percent === 25) throw new Error("boom");
    });
    const watcher = installScrollWatcher(window, onMilestone);

    expect(() => window.dispatchEvent(new Event("scroll"))).not.toThrow();

    expect(onMilestone.mock.calls.map((call) => call[0])).toEqual([25, 50]);
    watcher.dispose();
  });

  it("dispose 하면 더 알리지 않는다", () => {
    stubDocument(2000, 500, 500);
    const onMilestone = vi.fn();
    const watcher = installScrollWatcher(window, onMilestone);
    watcher.dispose();

    window.dispatchEvent(new Event("scroll"));

    expect(onMilestone).not.toHaveBeenCalled();
  });
});
