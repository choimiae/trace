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
