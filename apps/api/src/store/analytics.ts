import type Database from "better-sqlite3";
import { FEATURES_SQL, PAGE_VIEWS_SQL, SCREENS_SQL, SUMMARY_SQL, TITLES_SQL } from "./analytics-sql.js";
import { collapseScreens, compareText, rankRoutes } from "./route.js";
import type { FeatureUsage, PathRanking, ScreenUsage } from "./types.js";

// 집계 SQL 을 실행해 관리자 화면이 쓰는 응답 모양으로 묶는다. SqliteStore 가 위임한다.

export const SCREEN_LIMIT = 100;
export const FEATURES_PER_SCREEN = 30;
export const PATH_LIMIT = 20;
/** 글자도 역할도 없는 요소의 이름. */
export const UNNAMED_FEATURE = "이름 없는 요소";

export type Row = Record<string, unknown>;

export class Analytics {
  constructor(private readonly db: Database.Database) {}

  featureUsage(projectId: string, since: string): FeatureUsage {
    const params = { projectId, since };
    const summary = this.db.prepare(SUMMARY_SQL).get(params) as Row;

    const screens = new Map<string, ScreenUsage>();
    const screenOf = (urlPath: string): ScreenUsage => {
      let screen = screens.get(urlPath);
      if (!screen) {
        // 클릭만 있고 page_view 가 없는 경로(모달 경로 등)도 기능을 보여줄 자리가 있어야 한다.
        screen = { urlPath, name: urlPath, views: 0, visitors: 0, exitRate: 0, features: [] };
        screens.set(urlPath, screen);
      }
      return screen;
    };

    for (const row of this.db.prepare(SCREENS_SQL).all(params) as Row[]) {
      const screen = screenOf(row.url_path as string);
      screen.views = row.views as number;
      screen.visitors = row.visitors as number;
      screen.exitRate = (row.exits as number) / screen.views;
      if (row.average_dwell_ms !== null) screen.averageDwellMs = Math.round(row.average_dwell_ms as number);
    }

    // 클릭 수 순으로 정렬돼 온다.
    for (const row of this.db.prepare(FEATURES_SQL).all(params) as Row[]) {
      const screen = screenOf(row.url_path as string);
      if (screen.features.length >= FEATURES_PER_SCREEN) continue;
      const role = (row.role as string | null) ?? undefined;
      screen.features.push({
        elementKey: row.element_key as string,
        name: (row.text as string | null) ?? role ?? UNNAMED_FEATURE,
        ...(role === undefined ? {} : { role }),
        clicks: row.clicks as number,
        visitors: row.visitors as number,
      });
    }

    const top = [...screens.values()]
      .sort((a, b) => b.views - a.views || compareText(a.urlPath, b.urlPath))
      .slice(0, SCREEN_LIMIT);
    const names = this.names(projectId, since, top.map((screen) => screen.urlPath));
    for (const screen of top) screen.name = names[screen.urlPath]!;

    return {
      summary: {
        visitors: summary.visitors as number,
        sessions: summary.sessions as number,
        averageSessionMs: summary.average_session_ms === null ? 0 : Math.round(summary.average_session_ms as number),
      },
      screens: top,
    };
  }

  pathRanking(projectId: string, since: string, start?: string): PathRanking {
    const screensBySession = this.periodScreens(projectId, since);
    const { totalSessions, paths } = rankRoutes(screensBySession.values(), start, PATH_LIMIT);
    const seen = new Set<string>();
    for (const screens of screensBySession.values()) for (const screen of screens) seen.add(screen);
    return { totalSessions, paths, names: this.names(projectId, since, [...seen].sort(compareText)) };
  }

  /** 기간 세션마다 합친 화면 배열. page_view 가 없는 세션은 들어가지 않는다. */
  private periodScreens(projectId: string, since: string): Map<string, string[]> {
    return groupScreens(this.db.prepare(PAGE_VIEWS_SQL).all({ projectId, since }) as Row[]);
  }

  /** 경로마다 기간 세션에서 가장 많이 나온 제목. 없으면 경로 그대로. */
  private names(projectId: string, since: string, urlPaths: Iterable<string>): Record<string, string> {
    const titles = new Map<string, string>();
    for (const row of this.db.prepare(TITLES_SQL).all({ projectId, since }) as Row[]) {
      const urlPath = row.url_path as string;
      if (!titles.has(urlPath)) titles.set(urlPath, row.title_masked as string);
    }
    const names: Record<string, string> = {};
    for (const urlPath of urlPaths) names[urlPath] = titles.get(urlPath) ?? urlPath;
    return names;
  }
}

/** session_id 순으로 정렬된 page_view 행을 세션마다 묶어 연달아 같은 화면을 합친다. */
export function groupScreens(rows: Row[]): Map<string, string[]> {
  const raw = new Map<string, string[]>();
  for (const row of rows) {
    const sessionId = row.session_id as string;
    const urlPath = row.url_path as string;
    const list = raw.get(sessionId);
    if (list) list.push(urlPath);
    else raw.set(sessionId, [urlPath]);
  }
  return new Map([...raw].map(([sessionId, urlPaths]) => [sessionId, collapseScreens(urlPaths)]));
}
