import { afterEach, describe, expect, it, vi } from "vitest";
import { installNavigationWatcher } from "./navigation.js";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("installNavigationWatcher", () => {
  it("pushState 로 경로가 바뀌면 알린다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/settings");

    expect(onRouteChange).toHaveBeenCalledWith("/settings");
    dispose();
  });

  // SPA 는 같은 경로로 replaceState 를 자주 부른다. 거르지 않으면 같은 화면이
  // 수십 줄 쌓인다.
  it("같은 경로로 다시 밀면 알리지 않는다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/settings");
    window.history.replaceState(null, "", "/settings");
    window.history.pushState(null, "", "/settings");

    expect(onRouteChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("쿼리만 바뀐 이동은 같은 페이지로 본다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/settings");
    window.history.pushState(null, "", "/settings?tab=2");

    expect(onRouteChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("해시 라우트를 경로로 읽는다", () => {
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/#/reports");

    expect(onRouteChange).toHaveBeenCalledWith("/reports");
    dispose();
  });

  it("popstate 로 뒤로 가도 알린다", () => {
    const originalReplaceState = window.history.replaceState;
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);

    window.history.pushState(null, "", "/settings");
    onRouteChange.mockClear();
    originalReplaceState.call(window.history, null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(onRouteChange).toHaveBeenCalledWith("/");
    dispose();
  });

  it("dispose 하면 원래 history 로 되돌리고 더 알리지 않는다", () => {
    const original = window.history.pushState;
    const onRouteChange = vi.fn();
    const dispose = installNavigationWatcher(window, onRouteChange);
    dispose();

    window.history.pushState(null, "", "/settings");

    expect(onRouteChange).not.toHaveBeenCalled();
    expect(window.history.pushState).toBe(original);
  });
});
