// 집계 화면 세 개가 쓰는 SQL. 설계: docs/superpowers/specs/2026-10-10-stage3-1-aggregation-api-design.md
//
// 모든 쿼리는 "기간 세션"(기준 시각 @since 이후에 시작한 세션)에서 출발한다.
// 이벤트는 기간 세션에서부터 (project_id, session_id) 로 찾아간다 — 반대로 이벤트를
// 돌며 기간 세션을 찾으면 프로젝트 이벤트 전부를 훑는다. CROSS JOIN 은 SQLite 에서
// 조인 순서를 고정하는 문법이고, MATERIALIZED 는 기간 세션을 한 번만 계산하게 한다.
// 쿼리 계획은 analytics-sql.test.ts 가 지킨다.

const PERIOD_SESSIONS = `
  candidates AS (
    -- events_project_timestamp_session 인덱스 하나로 끝난다(테이블을 읽지 않는다).
    SELECT DISTINCT session_id FROM events
     WHERE project_id = @projectId AND timestamp >= @since
  ),
  period_sessions AS MATERIALIZED (
    -- 기준 시각 전에도 이벤트가 있으면 그 전에 시작한 세션이다.
    SELECT c.session_id FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM events o
        WHERE o.project_id = @projectId AND o.session_id = c.session_id AND o.timestamp < @since
     )
  )`;

// 시각 차(ms). 차를 먼저 반올림해 정수로 만든다 — julianday 의 부동소수 오차가
// 평균에 쌓이지 않게 한다. Date.parse 로 뺀 값과 같다.
const elapsedMs = (later: string, earlier: string) =>
  `ROUND((julianday(${later}) - julianday(${earlier})) * 86400000.0)`;

export const SUMMARY_SQL = `
  WITH ${PERIOD_SESSIONS},
  per_session AS (
    SELECT e.session_id,
           -- 한 세션은 한 탭에서 오므로 방문자 ID 는 하나다. MIN 은 집계 문법을 맞추려는 것이다.
           MIN(e.anonymous_user_id) AS visitor,
           MIN(e.timestamp) AS started_at,
           MAX(e.timestamp) AS last_seen_at
      FROM period_sessions ps
     CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
     GROUP BY e.session_id
  )
  SELECT COUNT(*) AS sessions,
         COUNT(DISTINCT visitor) AS visitors,
         AVG(${elapsedMs("last_seen_at", "started_at")}) AS average_session_ms
    FROM per_session`;

// 체류와 이탈은 store/page-stats.ts 와 같은 정의다. 다음 page_view 까지(양 끝 포함)
// 사이에서 같은 경로의 가장 이른 page_leave 가 체류의 끝이고, 다음 page_view 가
// 없으면 그 세션의 마지막 화면(이탈)이다. <= 인 이유는 page-stats.ts 주석에 있다.
export const SCREENS_SQL = `
  WITH ${PERIOD_SESSIONS},
  views AS (
    SELECT e.session_id, e.url_path, e.timestamp, e.anonymous_user_id,
           LEAD(e.timestamp) OVER (PARTITION BY e.session_id ORDER BY e.timestamp, e.rowid) AS next_at
      FROM period_sessions ps
     CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
     WHERE e.type = 'page_view'
  ),
  measured AS (
    SELECT v.url_path,
           v.anonymous_user_id,
           v.timestamp AS viewed_at,
           v.next_at IS NULL AS exited,
           (SELECT MIN(l.timestamp) FROM events l
             WHERE l.project_id = @projectId AND l.session_id = v.session_id
               AND l.type = 'page_leave' AND l.url_path = v.url_path
               AND l.timestamp >= v.timestamp
               AND (v.next_at IS NULL OR l.timestamp <= v.next_at)) AS left_at
      FROM views v
  )
  SELECT url_path,
         COUNT(*) AS views,
         COUNT(DISTINCT anonymous_user_id) AS visitors,
         AVG(${elapsedMs("left_at", "viewed_at")}) AS average_dwell_ms,
         SUM(exited) AS exits
    FROM measured
   GROUP BY url_path`;

export const FEATURES_SQL = `
  WITH ${PERIOD_SESSIONS}
  SELECT e.url_path,
         e.element_key,
         -- element_key 가 글자를 포함하므로 한 기능의 글자는 하나다. MAX 는 집계 문법을 맞추려는 것이다.
         MAX(e.element_text_masked_or_limited) AS text,
         MAX(e.element_role) AS role,
         COUNT(*) AS clicks,
         COUNT(DISTINCT e.anonymous_user_id) AS visitors
    FROM period_sessions ps
   CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
   WHERE e.type = 'click' AND e.element_key IS NOT NULL
   GROUP BY e.url_path, e.element_key
   ORDER BY clicks DESC, e.element_key`;

// 경로마다 횟수가 많은 순, 같으면 제목 순(BINARY). 처음 나온 제목이 그 경로의 이름이다.
export const TITLES_SQL = `
  WITH ${PERIOD_SESSIONS}
  SELECT e.url_path, e.title_masked, COUNT(*) AS n
    FROM period_sessions ps
   CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
   WHERE e.type = 'page_view' AND e.title_masked IS NOT NULL AND e.title_masked <> ''
   GROUP BY e.url_path, e.title_masked
   ORDER BY e.url_path, n DESC, e.title_masked`;

// 경로 계산에 쓰는 page_view 세 열. 같은 밀리초면 저장한 순서(rowid)로 놓는다.
// 클릭·스크롤은 읽지 않는다.
export const PAGE_VIEWS_SQL = `
  WITH ${PERIOD_SESSIONS}
  SELECT e.session_id, e.url_path
    FROM period_sessions ps
   CROSS JOIN events e ON e.project_id = @projectId AND e.session_id = ps.session_id
   WHERE e.type = 'page_view'
   ORDER BY e.session_id, e.timestamp, e.rowid`;

/** 기간 세션에서 출발하는 쿼리 전부. analytics-sql.test.ts 가 쿼리 계획을 확인한다. */
export const PERIOD_QUERIES: Record<string, string> = {
  SUMMARY_SQL,
  SCREENS_SQL,
  FEATURES_SQL,
  TITLES_SQL,
  PAGE_VIEWS_SQL,
};
