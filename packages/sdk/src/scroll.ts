export const SCROLL_MILESTONES = [25, 50, 75, 100] as const;

/** 아직 안 보낸 구간 중 이번 깊이로 넘은 것들. 오름차순이다. */
export function reachedMilestones(
  depthPercent: number,
  already: ReadonlySet<number>,
): number[] {
  return SCROLL_MILESTONES.filter(
    (milestone) => depthPercent >= milestone && !already.has(milestone),
  );
}

export function installScrollWatcher(
  target: Window,
  onMilestone: (percent: number) => void,
): { reset: () => void; dispose: () => void } {
  let sent = new Set<number>();

  const onScroll = () => {
    const documentHeight = target.document.documentElement.scrollHeight;
    const viewportHeight = target.innerHeight;
    // 스크롤이 불가능한 문서는 세지 않는다. 100% 를 즉시 보내면 "끝까지
    // 읽었다" 와 구분되지 않는다.
    if (documentHeight <= viewportHeight) return;

    // 화면 바닥 기준이다. scrollTop / (documentHeight - viewportHeight) 로
    // 재면 "얼마나 움직였나" 가 되어 문서 길이에 따라 같은 25% 가 다른
    // 의미가 된다.
    const depthPercent = ((target.scrollY + viewportHeight) / documentHeight) * 100;
    for (const milestone of reachedMilestones(depthPercent, sent)) {
      sent.add(milestone);
      onMilestone(milestone);
    }
  };

  target.addEventListener("scroll", onScroll, { passive: true });

  return {
    reset: () => {
      sent = new Set();
    },
    dispose: () => target.removeEventListener("scroll", onScroll),
  };
}
