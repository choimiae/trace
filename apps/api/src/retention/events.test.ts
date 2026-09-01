import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { eventRetentionCutoff, runEventRetention } from "./events.js";

describe("event retention", () => {
  it("computes the cutoff by subtracting retention days from now", () => {
    expect(eventRetentionCutoff(new Date("2026-09-01T12:00:00.000Z"), 30)).toBe("2026-08-02T12:00:00.000Z");
  });

  it("does nothing when event retention is not configured", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: [] });
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-08-01T00:00:01.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/",
      events: [{
        eventId: "evt_old",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-08-01T00:00:00.000Z",
        type: "page_view",
        urlPath: "/",
        metadata: {},
      }],
    });

    await expect(runEventRetention(store, {}, new Date("2026-09-01T00:00:00.000Z"))).resolves.toBe(0);
    await expect(store.listEvents(project.projectId)).resolves.toHaveLength(1);
  });

  it("deletes events older than the configured retention window", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: [] });
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-01T00:00:01.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/",
      events: [
        {
          eventId: "evt_old",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-08-01T23:59:59.999Z",
          type: "page_view",
          urlPath: "/",
          metadata: {},
        },
        {
          eventId: "evt_kept",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-08-02T00:00:00.000Z",
          type: "page_view",
          urlPath: "/",
          metadata: {},
        },
      ],
    });

    await expect(
      runEventRetention(store, { eventRetentionDays: 30 }, new Date("2026-09-01T00:00:00.000Z")),
    ).resolves.toBe(1);
    expect((await store.listEvents(project.projectId)).map((event) => event.eventId)).toEqual(["evt_kept"]);
  });
});
