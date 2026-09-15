import { redactUrl } from "@trace/shared/privacy";

/**
 * SPA 라우팅을 감지한다. `page_view` 가 최초 1회만 나가던 것이 이 제품에서
 * "어떤 페이지를 거쳤나" 를 통째로 비게 만들었다.
 *
 * Navigation API 를 쓰지 않는다 — Chrome 계열 전용이라 self-hosted 고객의
 * 브라우저를 가른다. history 패치는 오래된 방식이지만 어디서나 돈다.
 */
export function installNavigationWatcher(
  target: Window,
  onRouteChange: (urlPath: string) => void,
): () => void {
  const currentPath = () => redactUrl(target.location.href).urlPath;
  let lastPath = currentPath();

  const notifyIfChanged = () => {
    try {
      const next = currentPath();
      // 쿼리만 바뀐 이동은 같은 페이지다. 정제된 경로로만 비교한다.
      if (next === lastPath) return;
      lastPath = next;
      onRouteChange(next);
    } catch {
      // 이 함수는 호스트 라우터가 직접 부르는 pushState/replaceState 패치 안에서
      // 동기로 돈다. redactUrl(new URL 을 쓴다)이나 onRouteChange(수집 콜백)가
      // 던지면 그 예외가 패치된 history 메서드를 뚫고 나가 고객의 라우팅 자체를
      // 깨뜨린다. 이 알림 한 건을 버리는 것으로 막는다 - 수집 실패가 고객
      // 사이트를 망가뜨려서는 안 된다.
    }
  };

  const history = target.history;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function patchedPushState(...args) {
    originalPushState.apply(this, args);
    notifyIfChanged();
  };
  history.replaceState = function patchedReplaceState(...args) {
    originalReplaceState.apply(this, args);
    notifyIfChanged();
  };

  target.addEventListener("popstate", notifyIfChanged);
  target.addEventListener("hashchange", notifyIfChanged);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    target.removeEventListener("popstate", notifyIfChanged);
    target.removeEventListener("hashchange", notifyIfChanged);
  };
}
