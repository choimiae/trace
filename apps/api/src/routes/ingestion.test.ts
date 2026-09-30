import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createTestStore } from "../store/test-store.js";

describe("ingestion routes", () => {
  function batchPayload(projectId: string, events: unknown[]) {
    return {
      projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-09-30T00:00:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://app.example.com/quote",
      events,
    };
  }

  it("모르는 종류의 이벤트는 버리고 나머지를 저장한다", async () => {
    const store = createTestStore();
    const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://app.example.com" },
      payload: batchPayload(project.projectId, [
        { eventId: "evt_1", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:00.000Z", type: "js_error", urlPath: "/quote", metadata: {} },
        { eventId: "evt_2", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:01.000Z", type: "click", urlPath: "/quote", metadata: {} },
      ]),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 1 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline.map((event) => event.type)).toEqual(["click"]);
    await app.close();
  });

  it("남는 이벤트가 없어도 202 로 받는다", async () => {
    const store = createTestStore();
    const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://app.example.com" },
      payload: batchPayload(project.projectId, [
        { eventId: "evt_1", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:00.000Z", type: "custom_event", urlPath: "/quote", metadata: {} },
      ]),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 0 });
    await app.close();
  });

  it("화면 맥락과 오류 필드는 저장하지 않는다", async () => {
    const store = createTestStore();
    const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });
    const app = createApp({ store });

    await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://app.example.com" },
      payload: batchPayload(project.projectId, [
        {
          eventId: "evt_1", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:00.000Z",
          type: "click", urlPath: "/quote", metadata: {},
          errorName: "TypeError", screenContext: { viewport: { width: 100, height: 100 }, layoutHints: [] },
        },
      ]),
    });

    const [click] = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(click).toBeDefined();
    expect(click).not.toHaveProperty("screenContext");
    expect(click).not.toHaveProperty("errorName");
    await app.close();
  });

  it("accepts a valid raw batch from an allowed domain and stores sanitized events", async () => {
    const store = createTestStore();
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
            type: "click",
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
    const events = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(events[0]?.urlPath).toBe("/users/:id/settings");
    expect(events[0]?.urlQueryRedacted).toBe("?redacted_param_1=[redacted]&tab=[redacted]");
    expect(events[0]?.metadata).toEqual({ eventName: "member_invite_started" });
  });

  it("does not store unsafe raw identifiers or element labels", async () => {
    const store = createTestStore();
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
    const [session] = await store.listSessions(project.projectId, 10);
    const [event] = await store.getSessionTimeline(project.projectId, session?.sessionId ?? "");
    expect(event?.eventId).toMatch(/^evt_/);
    expect(event?.sessionId).toMatch(/^sess_/);
    expect(event?.pageId).toMatch(/^page_/);
    expect(event?.elementSelectorHash).toBeUndefined();
    expect(event?.elementRole).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("choi@example.com");
    expect(JSON.stringify(event)).not.toContain("sk_live");
  });

  it("preserves each event's sanitized URL path within a mixed-page batch", async () => {
    const store = createTestStore();
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
    const events = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(events.map((event) => event.urlPath)).toEqual(["/users/:id/settings", "/reports/:id"]);
  });

  it("측정 불가한 뷰포트 크기는 배치를 거절하지 않고 필드만 버린다", async () => {
    // SDK 는 window.innerWidth/innerHeight 를 무조건 보낸다. 숨은 iframe 이나
    // 레이아웃 전에는 0 이고, 브라우저 확대 상태에서는 소수가 될 수 있다.
    // 어느 쪽도 배치 전체를 400 으로 떨어뜨려서는 안 된다.
    const store = createTestStore();
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
        sentAt: "2026-09-02T01:00:03.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_hidden_iframe",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            viewportX: 0,
            viewportY: 0,
            metadata: {},
          },
          {
            eventId: "evt_zoomed",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            viewportX: 1279.5,
            viewportY: 719.5,
            metadata: {},
          },
          {
            eventId: "evt_ok",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:02.000Z",
            type: "click",
            urlPath: "/settings",
            viewportX: 1440,
            viewportY: 900,
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 3 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline).toHaveLength(3);
    // 0 은 측정 불가이므로 필드를 버린다.
    expect(timeline[0]).not.toHaveProperty("viewportX");
    expect(timeline[0]).not.toHaveProperty("viewportY");
    // 소수는 버리지 않고 반올림해 살린다.
    expect(timeline[1]?.viewportX).toBe(1280);
    expect(timeline[1]?.viewportY).toBe(720);
    expect(timeline[2]?.viewportX).toBe(1440);
    expect(timeline[2]?.viewportY).toBe(900);
  });

  it("rejects events from a disallowed domain", async () => {
    const store = createTestStore();
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

  it("prunes old events after storing a batch when event retention is configured", async () => {
    const store = createTestStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({
      store,
      eventRetentionConfig: { eventRetentionDays: 1 },
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-01T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_old_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-30T23:59:57.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_old_2",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-30T23:59:58.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_old_3",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-30T23:59:59.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_new",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-31T00:00:00.000Z",
            type: "page_view",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect((await store.getSessionTimeline(project.projectId, "sess_1")).map((event) => event.eventId)).toEqual(["evt_new"]);
  });

});
