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

  it("stores safe screen context from ingested events", async () => {
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
        sentAt: "2026-09-02T01:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "저장",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline[0]?.screenContext?.target?.textMaskedOrLimited).toBe("저장");
  });

  it("마스킹되지 않은 화면 맥락 텍스트는 배치를 거절하지 않고 다시 마스킹한다", async () => {
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
        sentAt: "2026-09-02T01:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "user@example.com",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline[0]?.screenContext?.target?.textMaskedOrLimited).toBe("[redacted]");
  });

  it("일상적인 고객 DOM 에서 온 화면 맥락을 거절하지 않고 정리해서 저장한다", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });
    // redactText 를 1회만 적용한 제목. 자체 slice(0, 120) 경계 때문에 아직
    // 마스킹 대상이 남아 있어 screenContextSchema 를 그대로는 통과하지 못한다.
    const onceRedactedTitle = `${"가".repeat(107)}1234567890123`;

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_hostile",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              titleMasked: onceRedactedTitle,
              viewport: { width: 1440.4, height: 900 },
              target: {
                tagName: "DIV",
                role: "none presentation",
                selectorHash: "not a hash",
                rect: { x: -20, y: 0, width: 12000, height: 30000 },
              },
              layoutHints: Array.from({ length: 20 }, (_unused, index) => ({
                tagName: "section",
                masked: true,
                rect: { x: index, y: index, width: 40, height: 40 },
              })),
            },
          },
          {
            eventId: "evt_ok",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              titleMasked: "설정",
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "저장",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 2 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline.map((event) => event.eventId)).toEqual(["evt_hostile", "evt_ok"]);
    expect(timeline[0]?.screenContext).toMatchObject({
      titleMasked: `${"가".repeat(107)}[redacted]`,
      viewport: { width: 1440, height: 900 },
      target: {
        tagName: "div",
        rect: { x: 0, y: 0, width: 10000, height: 10000 },
      },
    });
    expect(timeline[0]?.screenContext?.target).not.toHaveProperty("role");
    expect(timeline[0]?.screenContext?.target).not.toHaveProperty("selectorHash");
    expect(timeline[0]?.screenContext?.layoutHints).toHaveLength(12);
    expect(timeline[1]?.screenContext?.target?.textMaskedOrLimited).toBe("저장");
  });

  it("복구할 수 없는 화면 맥락은 필드만 버리고 같은 배치의 다른 이벤트를 저장한다", async () => {
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
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_broken",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: "화면 맥락 아님",
          },
          {
            eventId: "evt_ok",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "저장",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 2 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).not.toHaveProperty("screenContext");
    expect(timeline[1]?.screenContext?.target?.textMaskedOrLimited).toBe("저장");
  });

  it("측정 불가한 뷰포트 크기는 배치를 거절하지 않고 필드만 버린다", async () => {
    // SDK 는 window.innerWidth/innerHeight 를 무조건 보낸다. 숨은 iframe 이나
    // 레이아웃 전에는 0 이고, 브라우저 확대 상태에서는 소수가 될 수 있다.
    // 어느 쪽도 배치 전체를 400 으로 떨어뜨려서는 안 된다.
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
        url: "https://demo.example.com/#/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_2",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_3",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:02.000Z",
            type: "click",
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

  it("prunes old events after storing detected issues when event retention is configured", async () => {
    const store = new MemoryStore();
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
    expect((await store.listEvents(project.projectId)).map((event) => event.eventId)).toEqual(["evt_new"]);
    expect((await store.listIssues(project.projectId)).map((issue) => issue.issueType)).toContain("rage_click");
  });
});
