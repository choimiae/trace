import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SQLITE_SCHEMA } from "../db/schema.sqlite.js";
import { PERIOD_QUERIES } from "./analytics-sql.js";

// 쓰지 않는 이름은 better-sqlite3 가 무시한다(빠진 이름은 던진다). 모든 쿼리에 같은 값을 넘긴다.
const PARAMS = {
  projectId: "proj_1",
  since: "2026-10-01T00:00:00.000Z",
  urlPath: "/a",
  elementKey: "k",
  limit: 50,
  sessionIds: "[]",
};

// 통계(ANALYZE)가 없는 실제 DB 와 같은 조건이다. 빈 테이블과 데이터가 든 테이블의 계획이 같은 것을
// 계획을 쓸 때 확인했다.
function planOf(sql: string): string[] {
  const db = new Database(":memory:");
  db.exec(SQLITE_SCHEMA);
  try {
    return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(PARAMS) as Array<{ detail: string }>).map((row) => row.detail);
  } finally {
    db.close();
  }
}

describe("집계 쿼리 계획", () => {
  it.each(Object.entries(PERIOD_QUERIES))("%s: events 를 인덱스 없이 훑지 않는다", (_name, sql) => {
    // events 테이블의 별칭은 events·e·o·l·f 뿐이다. CTE(c, ps, v, s …)를 훑는 것은 괜찮다.
    expect(planOf(sql).filter((detail) => /^SCAN (events|e|o|l|f)\b/.test(detail))).toEqual([]);
  });

  it.each(Object.entries(PERIOD_QUERIES))("%s: 기간 세션 후보를 시각 범위로 찾는다", (_name, sql) => {
    expect(planOf(sql)).toContain(
      "SEARCH events USING COVERING INDEX events_project_timestamp_session (project_id=? AND timestamp>?)",
    );
  });

  it.each(Object.entries(PERIOD_QUERIES))("%s: 이벤트를 기간 세션에서부터 찾아간다", (_name, sql) => {
    // 이벤트 쪽에서 출발하면 (project_id=?) 하나로 프로젝트 전체를 돈다.
    expect(planOf(sql).filter((detail) => /^SEARCH (e|f|l|o) .*\(project_id=\?\)$/.test(detail))).toEqual([]);
  });
});
