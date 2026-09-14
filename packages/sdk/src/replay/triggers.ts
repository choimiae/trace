export type TriggerReason = "rage_click" | "js_error" | "dead_click";

export const RAGE_CLICK_COUNT = 3;
export const RAGE_CLICK_WINDOW_MS = 3000;
export const DEAD_CLICK_TIMEOUT_MS = 2000;

export interface TriggerHandle {
  /** rrweb 이 DOM 변경 이벤트를 낼 때마다 부른다. 반응 없는 클릭 판정에 쓴다. */
  notifyMutation(): void;
  dispose(): void;
}

/**
 * "이 세션을 올릴까?" 를 묻는 느슨한 필터다. 서버의 이슈 탐지(detect.ts)와
 * 일부러 다르다 - 서버는 "이게 이슈인가?" 를 정확히 판정하는 정본이고, 여기는
 * 놓치는 것보다 더 올리는 쪽이 낫다. 틀렸을 때의 대가도 다르다: 여기가 틀리면
 * 리플레이 몇 개가 더 저장될 뿐이고, 서버가 틀리면 이슈 판정이 틀린다.
 *
 * 특히 반응 없는 클릭의 기준이 다르다 - 서버는 "2초 안에 같은 세션의 다른
 * 이벤트가 없음", 여기는 "2초 안에 DOM 변경이 없음" 이다. 같게 만들려 하지
 * 않는다. 이 저장소는 상수 하나를 두 벌로 갈라 뒀다가 조용히 깨진 전례가
 * 있고(계약 20 / 수집 API 12), 여기서 어긋나면 실패가 더 조용하다 -
 * 리플레이가 그냥 안 올라온다.
 */
export function installTriggers(
  target: Window,
  options: { onTrigger: (reason: TriggerReason) => void; now?: () => number },
): TriggerHandle {
  const now = options.now ?? (() => Date.now());

  let lastTarget: EventTarget | null = null;
  let clickTimes: number[] = [];
  let deadClickTimer: ReturnType<typeof setTimeout> | undefined;
  let mutatedSinceClick = false;
  let disposed = false;

  const clearDeadClickTimer = () => {
    if (deadClickTimer !== undefined) {
      clearTimeout(deadClickTimer);
      deadClickTimer = undefined;
    }
  };

  const onClick = (event: Event) => {
    if (disposed) return;
    const at = now();

    if (event.target !== lastTarget) {
      lastTarget = event.target;
      clickTimes = [];
    }
    clickTimes = clickTimes.filter((time) => at - time < RAGE_CLICK_WINDOW_MS);
    clickTimes.push(at);
    if (clickTimes.length >= RAGE_CLICK_COUNT) {
      clickTimes = [];
      options.onTrigger("rage_click");
    }

    mutatedSinceClick = false;
    clearDeadClickTimer();
    deadClickTimer = setTimeout(() => {
      deadClickTimer = undefined;
      if (!disposed && !mutatedSinceClick) options.onTrigger("dead_click");
    }, DEAD_CLICK_TIMEOUT_MS);
  };

  const onError = () => {
    if (!disposed) options.onTrigger("js_error");
  };

  // 캡처 단계에서 듣는다. 고객 사이트가 stopPropagation 을 부르면 버블 단계
  // 리스너에는 클릭이 오지 않는다.
  target.addEventListener("click", onClick, true);
  target.addEventListener("error", onError);

  return {
    notifyMutation() {
      mutatedSinceClick = true;
    },
    dispose() {
      disposed = true;
      clearDeadClickTimer();
      target.removeEventListener("click", onClick, true);
      target.removeEventListener("error", onError);
    },
  };
}
