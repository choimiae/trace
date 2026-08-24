import { describe, expect, it } from "vitest";
import { eventBatchSchema } from "./events";

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
          metadata: { source: "auto" },
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

  it("accepts allowlisted safe metadata", () => {
    const parsed = eventBatchSchema.parse({
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
          metadata: { eventName: "report_export_clicked", durationMs: 20000, source: "auto" },
        },
      ],
    });

    expect(parsed.events[0]?.metadata).toEqual({
      eventName: "report_export_clicked",
      durationMs: 20000,
      source: "auto",
    });
  });

  it("rejects metadata values outside key-specific contracts", () => {
    for (const metadata of [
      { source: 1012345678 },
      { source: true },
      { status: null },
      { durationMs: 600001 },
      { responseMs: -1 },
      { score: 101 },
      { endpoint: "/api/reports?format=json" },
      { feature: { durationMs: 123456789012 } },
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

  it("rejects sensitive strings in nested metadata", () => {
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
