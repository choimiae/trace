import { describe, expect, it } from "vitest";
import { eventBatchSchema, eventTypeSchema, traceEventSchema } from "./events.js";

describe("eventBatchSchema", () => {
  it("accepts a valid click batch", () => {
    const parsed = eventBatchSchema.parse({
      projectId: "proj_123",
      anonymousUserId: "anon_123",
      sessionId: "sess_123",
      sentAt: "2026-08-24T00:00:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings?filter=[redacted]",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_123",
          pageId: "page_1",
          timestamp: "2026-08-24T00:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          urlQueryRedacted: "?filter=[redacted]",
          elementSelectorHash: "abc123",
          elementRole: "button",
          elementTextMaskedOrLimited: "멤버 초대",
          x: 120,
          y: 48,
          viewportX: 1440,
          viewportY: 900,
          metadata: {},
        },
      ],
    });

    expect(parsed.events[0]?.type).toBe("click");
  });

  it("rejects unknown event types", () => {
    expect(() =>
      eventBatchSchema.parse({
        projectId: "proj_123",
        anonymousUserId: "anon_123",
        sessionId: "sess_123",
        sentAt: "2026-08-24T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://example.com/settings",
        events: [
          {
            eventId: "evt_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "unknown_event",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects raw query values in batch and event URLs", () => {
    expect(() =>
      eventBatchSchema.parse({
        projectId: "proj_123",
        anonymousUserId: "anon_123",
        sessionId: "sess_123",
        sentAt: "2026-08-24T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://example.com/settings?email=user@example.com",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_123",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      eventBatchSchema.parse({
        projectId: "proj_123",
        anonymousUserId: "anon_123",
        sessionId: "sess_123",
        sentAt: "2026-08-24T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_123",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            urlQueryRedacted: "?token=abc",
            metadata: {},
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects sensitive query keys", () => {
    expect(() =>
      eventBatchSchema.parse({
        projectId: "proj_123",
        anonymousUserId: "anon_123",
        sessionId: "sess_123",
        sentAt: "2026-08-24T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://example.com/settings?choi@example.com=[redacted]",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_123",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      eventBatchSchema.parse({
        projectId: "proj_123",
        anonymousUserId: "anon_123",
        sessionId: "sess_123",
        sentAt: "2026-08-24T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_123",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            urlQueryRedacted: "?token=[redacted]",
            metadata: {},
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects unapproved metadata keys", () => {
    for (const metadata of [
      { name: "Alice" },
      { token: "abc" },
      { inputValue: "safe_label" },
      { "user@example.com": "safe_label" },
    ]) {
      expect(() =>
        eventBatchSchema.parse({
          projectId: "proj_123",
          anonymousUserId: "anon_123",
          sessionId: "sess_123",
          sentAt: "2026-08-24T00:00:00.000Z",
          sdkVersion: "0.1.0",
          url: "https://example.com/settings",
          events: [
            {
              eventId: "evt_1",
              sessionId: "sess_123",
              pageId: "page_1",
              timestamp: "2026-08-24T00:00:00.000Z",
              type: "click",
              urlPath: "/settings",
              metadata,
            },
          ],
        }),
      ).toThrow();
    }
  });

  it("rejects nested metadata values", () => {
    expect(() =>
      eventBatchSchema.parse({
        projectId: "proj_123",
        anonymousUserId: "anon_123",
        sessionId: "sess_123",
        sentAt: "2026-08-24T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_123",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {
              feature: [
                { message: "user@example.com" },
                { status: "010-1234-5678" },
                { target: "123456789" },
              ],
            },
          },
        ],
      }),
    ).toThrow();
  });
});

describe("계약 축소", () => {
  it("남긴 네 종류만 이벤트 종류로 받는다", () => {
    expect(eventTypeSchema.options).toEqual(["page_view", "page_leave", "click", "scroll"]);
  });

  it("스크롤 도달 metadata 만 받는다", () => {
    const base = {
      eventId: "evt_1", sessionId: "sess_1", pageId: "page_1",
      timestamp: "2026-09-30T00:00:00.000Z", type: "scroll", urlPath: "/quote",
    };
    expect(traceEventSchema.safeParse({ ...base, metadata: { metric: "scroll_depth", score: 50 } }).success).toBe(true);
    expect(traceEventSchema.safeParse({ ...base, metadata: { eventName: "report_export" } }).success).toBe(false);
  });
});
