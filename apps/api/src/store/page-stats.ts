import type { TraceEvent } from "@trace/shared";
import type { PageStats } from "./types.js";

const SCROLL_DEPTHS = [25, 50, 75, 100];

/**
 * 이벤트에서 페이지 통계를 낸다. 두 스토어 구현이 같은 답을 내야 하므로
 * 계산은 여기 한 곳에만 둔다.
 */
export function computePageStats(events: TraceEvent[], limit: number): PageStats[] {
  const bySession = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const list = bySession.get(event.sessionId) ?? [];
    list.push(event);
    bySession.set(event.sessionId, list);
  }

  const views = new Map<
    string,
    { count: number; dwellMs: number[]; exits: number; reached: Map<number, number> }
  >();
  const bucket = (urlPath: string) => {
    const existing = views.get(urlPath);
    if (existing) return existing;
    const created = { count: 0, dwellMs: [] as number[], exits: 0, reached: new Map<number, number>() };
    views.set(urlPath, created);
    return created;
  };

  for (const sessionEvents of bySession.values()) {
    const ordered = [...sessionEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const pageViews = ordered.filter((event) => event.type === "page_view");
    const lastView = pageViews[pageViews.length - 1];

    for (const [index, view] of pageViews.entries()) {
      const target = bucket(view.urlPath);
      target.count += 1;
      if (view === lastView) target.exits += 1;

      const nextView = pageViews[index + 1];
      // <= 다. 라우팅으로 페이지를 옮기면 직전 경로의 page_leave 와 다음
      // page_view 가 같은 동기 tick 에서 나가 같은 밀리초를 찍는 일이 흔하다
      // (contract fixture 의 00:00:10.000Z 쌍이 그 경우다). < 로 좁히면 이런
      // 라우팅 이탈마다 체류가 통째로 사라진다 — 건드리지 않는다.
      const leave = ordered.find(
        (event) =>
          event.type === "page_leave" &&
          event.urlPath === view.urlPath &&
          event.timestamp >= view.timestamp &&
          (nextView === undefined || event.timestamp <= nextView.timestamp),
      );
      if (leave) target.dwellMs.push(Date.parse(leave.timestamp) - Date.parse(view.timestamp));

      // page_leave 와 같은 <= 다. 경계 밀리초에 걸친 스크롤도 event.urlPath
      // === view.urlPath 가 이미 걸러 주므로(다음 페이지의 스크롤은 urlPath
      // 가 달라 여기 섞이지 않는다) < 로 좁혀 둘 이유가 없었다 — 드물게
      // 경계에 걸친 도달을 놓치는 손실만 있었다.
      const scrolls = ordered.filter(
        (event) =>
          event.type === "scroll" &&
          event.urlPath === view.urlPath &&
          event.timestamp >= view.timestamp &&
          (nextView === undefined || event.timestamp <= nextView.timestamp),
      );
      for (const depth of SCROLL_DEPTHS) {
        const hit = scrolls.some(
          (event) => event.metadata?.metric === "scroll_depth" && event.metadata?.score === depth,
        );
        if (hit) target.reached.set(depth, (target.reached.get(depth) ?? 0) + 1);
      }
    }
  }

  return Array.from(views.entries())
    .map(([urlPath, value]) => ({
      urlPath,
      views: value.count,
      averageDwellMs:
        value.dwellMs.length === 0
          ? undefined
          : Math.round(value.dwellMs.reduce((sum, ms) => sum + ms, 0) / value.dwellMs.length),
      exitRate: value.count === 0 ? 0 : value.exits / value.count,
      scrollReach: SCROLL_DEPTHS.map((depth) => ({
        depth,
        ratio: value.count === 0 ? 0 : (value.reached.get(depth) ?? 0) / value.count,
      })),
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}
