import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "./sqlite-store.js";

type Row = Record<string, unknown>;

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "trace-sqlite-store-"));
  tempDirs.push(directory);
  return join(directory, "trace.db");
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqliteStore event diagnostics", () => {
  it("migrates an existing events table to include received_at", () => {
    const dbPath = createTempDbPath();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        url_path TEXT NOT NULL,
        url_query_redacted TEXT,
        title_masked TEXT,
        element_selector_hash TEXT,
        element_role TEXT,
        element_text_masked_or_limited TEXT,
        x REAL,
        y REAL,
        viewport_x INTEGER,
        viewport_y INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      INSERT INTO events
        (event_id, project_id, session_id, page_id, timestamp, type, url_path, metadata)
      VALUES
        ('evt_legacy', 'proj_legacy', 'sess_1', 'page_1', '2026-09-01T06:00:00.000Z', 'click', '/settings', '{}');
    `);
    legacy.close();

    const store = new SqliteStore(dbPath);
    store.close();

    const migrated = new Database(dbPath, { readonly: true });
    try {
      const event = migrated
        .prepare("SELECT event_id, timestamp, received_at FROM events WHERE event_id = ?")
        .get("evt_legacy") as Row;
      expect(event).toMatchObject({
        event_id: "evt_legacy",
        timestamp: "2026-09-01T06:00:00.000Z",
        received_at: "2026-09-01T06:00:00.000Z",
      });

      const debugEvent = migrated
        .prepare("SELECT event_id, occurred_at_kst, received_at_kst FROM events_debug WHERE event_id = ?")
        .get("evt_legacy") as Row;
      expect(debugEvent).toMatchObject({
        event_id: "evt_legacy",
        occurred_at_kst: "2026-09-01 15:00:00.000",
        received_at_kst: "2026-09-01 15:00:00.000",
      });
    } finally {
      migrated.close();
    }
  });

  it("stores server received_at and exposes Korean-time debug view", async () => {
    const dbPath = createTempDbPath();
    const store = new SqliteStore(dbPath);
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });

    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-01T06:00:01.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/settings",
      events: [{
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-01T06:00:00.000Z",
        type: "click",
        urlPath: "/settings",
        metadata: {},
      }],
    });
    store.close();

    const db = new Database(dbPath, { readonly: true });
    try {
      const event = db
        .prepare("SELECT event_id, timestamp, received_at FROM events WHERE event_id = ?")
        .get("evt_1") as Row;
      expect(event.timestamp).toBe("2026-09-01T06:00:00.000Z");
      expect(typeof event.received_at).toBe("string");
      expect(Number.isNaN(Date.parse(event.received_at as string))).toBe(false);

      const debugEvent = db
        .prepare("SELECT event_id, occurred_at_kst, received_at_kst FROM events_debug WHERE event_id = ?")
        .get("evt_1") as Row;
      expect(debugEvent).toMatchObject({
        event_id: "evt_1",
        occurred_at_kst: "2026-09-01 15:00:00.000",
      });
      expect(debugEvent.received_at_kst).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    } finally {
      db.close();
    }
  });
});

describe("SqliteStore 요소 신원 마이그레이션", () => {
  // 옛 규칙 데이터는 SqliteStore 를 처음 열기 전에 심어야 한다. SqliteStore 생성자가
  // migrate() 를 돌리므로, 먼저 열면 마이그레이션이 빈 DB 에서 소비된다.
  function seedLegacy(dbPath: string): void {
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        url_path TEXT NOT NULL,
        url_query_redacted TEXT,
        title_masked TEXT,
        element_selector_hash TEXT,
        element_role TEXT,
        element_text_masked_or_limited TEXT,
        x REAL,
        y REAL,
        viewport_x INTEGER,
        viewport_y INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE issues (
        issue_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        affected_sessions_count INTEGER NOT NULL,
        affected_users_count INTEGER NOT NULL,
        severity_score INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        trend TEXT NOT NULL,
        related_url_path TEXT,
        related_feature_id TEXT,
        example_session_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL
      );

      INSERT INTO events
        (event_id, project_id, session_id, page_id, timestamp, type, url_path, element_selector_hash, metadata)
      VALUES
        ('evt_old', 'proj_1', 'sess_1', 'page_1', '2026-09-01T00:00:00.000Z', 'click', '/settings', 'ade22732', '{}');

      INSERT INTO issues
        (issue_id, project_id, issue_type, title, summary, affected_sessions_count, affected_users_count,
         severity_score, first_seen_at, last_seen_at, trend, example_session_ids, status)
      VALUES
        ('issue__|ade22732|rage_click', 'proj_1', 'rage_click', '제목', '요약', 1, 1, 100,
         '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'flat', '[]', 'new'),
        ('issue__|page|error_friction', 'proj_1', 'error_friction', '제목', '요약', 1, 1, 71,
         '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'flat', '[]', 'new');
    `);
    legacy.close();
  }

  it("옛 지문을 무효화하고 해시로 키잉된 이슈만 지운다", () => {
    const dbPath = createTempDbPath();
    seedLegacy(dbPath);

    const store = new SqliteStore(dbPath);
    store.close();

    const migrated = new Database(dbPath, { readonly: true });
    try {
      const event = migrated
        .prepare("SELECT element_selector_hash FROM events WHERE event_id = ?")
        .get("evt_old") as Row;
      const issueIds = (migrated.prepare("SELECT issue_id FROM issues").all() as Row[]).map(
        (row) => row.issue_id as string,
      );
      const version = migrated.prepare("PRAGMA user_version").get() as Row;

      expect(event.element_selector_hash).toBeNull();
      expect(issueIds).toEqual(["issue__|page|error_friction"]);
      expect(version.user_version).toBe(1);
    } finally {
      migrated.close();
    }
  });

  it("두 번째 실행은 새 이벤트의 지문을 지우지 않는다", () => {
    const dbPath = createTempDbPath();
    seedLegacy(dbPath);

    const first = new SqliteStore(dbPath);
    first.close();

    const added = new Database(dbPath);
    added
      .prepare(
        `INSERT INTO events
           (event_id, project_id, session_id, page_id, timestamp, type, url_path, element_selector_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "evt_new",
        "proj_1",
        "sess_1",
        "page_1",
        "2026-09-03T00:00:00.000Z",
        "click",
        "/settings",
        "aaaaaaaabbbbbbbb",
        "{}",
      );
    added.close();

    const second = new SqliteStore(dbPath);
    second.close();

    const checked = new Database(dbPath, { readonly: true });
    try {
      const event = checked
        .prepare("SELECT element_selector_hash FROM events WHERE event_id = ?")
        .get("evt_new") as Row;

      expect(event.element_selector_hash).toBe("aaaaaaaabbbbbbbb");
    } finally {
      checked.close();
    }
  });

  it("경로에 파이프가 섞인 지문 이슈와 지문을 가진 오류 이슈를 모두 정확히 가른다", () => {
    // 반례 1: urlPath 자체에 `|` 가 섞여 들어오면(issueTargetKey 의 허용 문자셋에
    // `|` 가 포함돼 있어 치환되지 않는다) 지문 키 이슈의 id 에도 우연히 `|page|`
    // 부분 문자열이 생길 수 있다. NOT LIKE '%|page|%' 같은 포함 여부 검사는 이런
    // 행을 잘못 살려둔다 — 이 이슈는 지문 키(abcd1234abcd1234)로 만들어졌으므로
    // 지워져야 한다.
    //
    // 반례 2: detectErrorFriction 도 다른 탐지기와 동일하게 elementKey(event) 를
    // 넘긴다 — 오류 이벤트가 지문을 안 갖는 것은 오늘 SDK 의 우연일 뿐 계약이
    // 아니다. issue_type 이 error_friction 이어도 키가 지문이면 그 이슈는
    // "error_friction 은 보존한다"는 타입 기준 예외에 들지 못하고 지워져야 한다
    // (지문이 NULL 로 지워지면 다음 배치에서 page 키로 다시 감지된다). 반대로
    // 진짜 page 키로 만들어진 error_friction 이슈는 살아남아야 한다 — 이 둘을
    // 한 테스트에 같이 둬서 판별이 양방향으로 맞는지 확인한다.
    const dbPath = createTempDbPath();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        url_path TEXT NOT NULL,
        url_query_redacted TEXT,
        title_masked TEXT,
        element_selector_hash TEXT,
        element_role TEXT,
        element_text_masked_or_limited TEXT,
        x REAL,
        y REAL,
        viewport_x INTEGER,
        viewport_y INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE issues (
        issue_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        affected_sessions_count INTEGER NOT NULL,
        affected_users_count INTEGER NOT NULL,
        severity_score INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        trend TEXT NOT NULL,
        related_url_path TEXT,
        related_feature_id TEXT,
        example_session_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL
      );

      INSERT INTO issues
        (issue_id, project_id, issue_type, title, summary, affected_sessions_count, affected_users_count,
         severity_score, first_seen_at, last_seen_at, trend, example_session_ids, status)
      VALUES
        ('issue__settings|page|abcd1234abcd1234|rage_click', 'proj_1', 'rage_click', '제목', '요약', 1, 1, 100,
         '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'flat', '[]', 'new'),
        ('issue__settings|abcd1234abcd1234|error_friction', 'proj_1', 'error_friction', '제목', '요약', 1, 1, 71,
         '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'flat', '[]', 'new'),
        ('issue__settings|page|error_friction', 'proj_1', 'error_friction', '제목', '요약', 1, 1, 71,
         '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'flat', '[]', 'new');
    `);
    legacy.close();

    const store = new SqliteStore(dbPath);
    store.close();

    const migrated = new Database(dbPath, { readonly: true });
    try {
      const issueIds = (migrated.prepare("SELECT issue_id FROM issues ORDER BY issue_id").all() as Row[]).map(
        (row) => row.issue_id as string,
      );

      expect(issueIds).toEqual(["issue__settings|page|error_friction"]);
    } finally {
      migrated.close();
    }
  });
});
