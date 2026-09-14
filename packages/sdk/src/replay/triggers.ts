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
  let disposed = false;

  // 클릭마다 독립된 반응-없는-클릭 타이머를 요소별로 쥔다. 다른 요소를
  // 누른다고 이 요소의 대기를 지우면 안 되므로(그러면 A 를 누르고 2초 안에
  // B 를 눌렀을 때 A 가 반응 없었다는 사실 자체가 사라진다) 단일 타이머가
  // 아니라 요소를 키로 삼는다.
  //
  // 다만 DOM 변경은 어떤 클릭이 일으켰는지 알 수 없다 - rrweb 은 "무엇이
  // 바뀌었는지" 가 아니라 "바뀌었다" 만 알려준다. 그래서 notifyMutation() 은
  // 그 시점에 대기 중인 타이머를 전부 지운다. 잔여 한계: A 를 누르고 반응이
  // 없는 채로 B 를 눌렀는데 B 가 (A 와 무관하게) 뭔가를 바꾸면, 그 변경이
  // A 의 대기까지 함께 지운다 - A 도 반응 없는 클릭이었다는 사실을 놓친다.
  // 이 클릭이 무엇을 바꿨는지 rrweb 이 알려주지 않는 한 고칠 수 없는 설계
  // 상의 한계라 그대로 둔다.
  const pendingDeadClicks = new Map<EventTarget, ReturnType<typeof setTimeout>>();

  const cancelDeadClick = (el: EventTarget) => {
    const timer = pendingDeadClicks.get(el);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingDeadClicks.delete(el);
    }
  };

  const cancelAllDeadClicks = () => {
    for (const timer of pendingDeadClicks.values()) clearTimeout(timer);
    pendingDeadClicks.clear();
  };

  const onClick = (event: Event) => {
    if (disposed) return;
    const at = now();
    const clickedTarget = event.target;

    if (clickedTarget !== lastTarget) {
      lastTarget = clickedTarget;
      clickTimes = [];
    }
    clickTimes = clickTimes.filter((time) => at - time < RAGE_CLICK_WINDOW_MS);
    clickTimes.push(at);
    if (clickTimes.length >= RAGE_CLICK_COUNT) {
      clickTimes = [];
      options.onTrigger("rage_click");
      // onTrigger 는 동기 호출이다 - 그 안에서 소비자가 dispose() 를 부를 수
      // 있다. 그러면 여기서 다시 확인해야 한다 - 안 그러면 죽은 뒤에도 반응
      // 없는 클릭 타이머 하나가 새로 걸려 DEAD_CLICK_TIMEOUT_MS 만큼 더
      // 살아남는다(스스로 disposed 를 봐 트리거는 안 하지만, 타이머 자체가
      // dispose() 의 "즉시 정리" 계약을 어긴다).
      if (disposed) return;
    }

    if (clickedTarget !== null) {
      // 같은 요소를 다시 누르면 그 요소에 걸린 이전 대기를 스스로 대체한다.
      // 다른 요소를 누르는 것은 취소 사유가 아니다 - 그 요소 몫의 타이머는
      // 위 Map 에 따로 걸려 있으므로 손대지 않는다.
      cancelDeadClick(clickedTarget);
      const timer = setTimeout(() => {
        pendingDeadClicks.delete(clickedTarget);
        if (!disposed) options.onTrigger("dead_click");
      }, DEAD_CLICK_TIMEOUT_MS);
      pendingDeadClicks.set(clickedTarget, timer);
    }
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
      cancelAllDeadClicks();
    },
    dispose() {
      disposed = true;
      cancelAllDeadClicks();
      // lastTarget 을 놓지 않으면 이 핸들을 쥔 쪽(예: Task 13, 모듈 수명
      // 내내 보관)이 살아 있는 한 마지막으로 클릭한 DOM 요소도 계속
      // 살아 있는다 - 페이지에서 이미 제거된 요소라도.
      lastTarget = null;
      clickTimes = [];
      target.removeEventListener("click", onClick, true);
      target.removeEventListener("error", onError);
    },
  };
}
