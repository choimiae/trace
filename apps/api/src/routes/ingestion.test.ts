import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { MemoryStore } from "../store/memory-store.js";

describe("ingestion routes", () => {
  it("accepts a valid raw batch from an allowed domain and stores sanitized events", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/users/123/settings?email=choi@example.com&tab=invite",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "custom_event",
            metadata: {
              name: "member_invite_started",
              email: "choi@example.com",
              nested: { phone: "010-1234-5678" },
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 1 });
    const events = await store.listEvents(project.projectId);
    expect(events[0]?.urlPath).toBe("/users/:id/settings");
    expect(events[0]?.urlQueryRedacted).toBe("?redacted_param_1=[redacted]&tab=[redacted]");
    expect(events[0]?.metadata).toEqual({ eventName: "member_invite_started" });
  });

  it("does not store unsafe raw identifiers or element labels", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "choi@example.com",
        sessionId: "choi@example.com",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "choi@example.com",
            sessionId: "choi@example.com",
            pageId: "sk_live_abcDEF",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "button choi@example.com",
            elementRole: "button choi@example.com",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const [event] = await store.listEvents(project.projectId);
    expect(event?.eventId).toMatch(/^evt_/);
    expect(event?.sessionId).toMatch(/^sess_/);
    expect(event?.pageId).toMatch(/^page_/);
    expect(event?.elementSelectorHash).toBeUndefined();
    expect(event?.elementRole).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("choi@example.com");
    expect(JSON.stringify(event)).not.toContain("sk_live");
  });

  it("preserves each event's sanitized URL path within a mixed-page batch", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: "/users/alice/settings",
            metadata: {},
          },
          {
            eventId: "evt_2",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            urlPath: "/reports/123",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const events = await store.listEvents(project.projectId);
    expect(events.map((event) => event.urlPath)).toEqual(["/users/:id/settings", "/reports/:id"]);
  });

  it("rejects events from a disallowed domain", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://evil.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://evil.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("detects and stores friction issues after accepting a batch", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:04.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_2",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_3",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:02.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const issues = await store.listIssues(project.projectId);
    expect(issues[0]).toMatchObject({
      issueType: "rage_click",
      relatedUrlPath: "/settings",
    });
  });
});
