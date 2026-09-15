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
      const leave = ordered.find(
        (event) =>
          event.type === "page_leave" &&
          event.urlPath === view.urlPath &&
          event.timestamp >= view.timestamp &&
          (nextView === undefined || event.timestamp <= nextView.timestamp),
      );
      if (leave) target.dwellMs.push(Date.parse(leave.timestamp) - Date.parse(view.timestamp));

      const scrolls = ordered.filter(
        (event) =>
          event.type === "scroll" &&
          event.urlPath === view.urlPath &&
          event.timestamp >= view.timestamp &&
          (nextView === undefined || event.timestamp < nextView.timestamp),
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
