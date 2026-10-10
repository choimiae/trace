import type { RankedPath } from "./types.js";

// 경로 규칙. 경로 순위, 세션 목록의 경로 필터, 세션 행의 지나간 화면이 모두
// 이 파일의 함수를 쓴다 — 셋이 같은 규칙으로 잘라야 순위의 세션 수와 필터한
// 목록의 건수가 맞는다. 설계: docs/superpowers/specs/2026-10-10-stage3-1-aggregation-api-design.md

export const ROUTE_MAX_STEPS = 5;

export interface Route {
  /** 시작 화면부터 최대 5개. */
  steps: string[];
  /** 자른 경로가 5개 화면 안에서 끝났는지. */
  exited: boolean;
}

/** 연달아 같은 경로(새로고침, 같은 화면 안의 라우팅)를 하나로 합친다. 떨어져 다시 나온 경로는 남긴다. */
export function collapseScreens(urlPaths: readonly string[]): string[] {
  const collapsed: string[] = [];
  for (const urlPath of urlPaths) {
    if (collapsed[collapsed.length - 1] !== urlPath) collapsed.push(urlPath);
  }
  return collapsed;
}

/**
 * 합친 화면 배열을 시작 화면이 처음 나온 지점에서 잘라 경로로 만든다.
 * 화면이 없거나 시작 화면이 없는 세션은 대상이 아니다.
 */
export function toRoute(screens: readonly string[], start?: string): Route | undefined {
  const from = start === undefined ? 0 : screens.indexOf(start);
  if (from < 0 || screens.length === 0) return undefined;
  const tail = screens.slice(from);
  return { steps: tail.slice(0, ROUTE_MAX_STEPS), exited: tail.length <= ROUTE_MAX_STEPS };
}

export function sameRoute(a: Route, b: Route): boolean {
  return (
    a.exited === b.exited &&
    a.steps.length === b.steps.length &&
    a.steps.every((step, index) => step === b.steps[index])
  );
}

/**
 * 세션들의 경로를 묶어 세션 수가 많은 순으로 센다. 세션 수가 같으면 경로를
 * 이은 문자열 순, 그것도 같으면 이탈하지 않은 쪽이 앞이다 — 결과가 실행마다
 * 흔들리지 않게 한다. 비율의 분모는 잘리지 않은 대상 세션 전체다.
 */
export function rankRoutes(
  sessions: Iterable<readonly string[]>,
  start: string | undefined,
  limit: number,
): { totalSessions: number; paths: RankedPath[] } {
  const groups = new Map<string, { route: Route; sessions: number }>();
  let totalSessions = 0;
  for (const screens of sessions) {
    const route = toRoute(screens, start);
    if (!route) continue;
    totalSessions += 1;
    const key = `${joinSteps(route.steps)}\u0000${route.exited ? 1 : 0}`;
    const group = groups.get(key);
    if (group) group.sessions += 1;
    else groups.set(key, { route, sessions: 1 });
  }

  const paths = [...groups.values()]
    .sort(
      (a, b) =>
        b.sessions - a.sessions ||
        compareText(joinSteps(a.route.steps), joinSteps(b.route.steps)) ||
        Number(a.route.exited) - Number(b.route.exited),
    )
    .slice(0, limit)
    .map(({ route, sessions }) => ({ ...route, sessions, ratio: sessions / totalSessions }));
  return { totalSessions, paths };
}

/** 로캘을 타지 않는 코드 단위 비교. SQLite 의 기본(BINARY) 정렬과 같은 순서다. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// NUL 은 경로에 나올 수 없어 경계가 겹치지 않는다.
function joinSteps(steps: readonly string[]): string {
  return steps.join("\u0000");
}
