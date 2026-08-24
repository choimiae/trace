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
      url: "https://example.com/settings?email=[redacted]",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_123",
          pageId: "page_1",
          timestamp: "2026-08-24T00:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          urlQueryRedacted: "?email=[redacted]",
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
              nested: [
                { email: "user@example.com" },
                { phone: "010-1234-5678" },
                { accountId: "123456789" },
              ],
            },
          },
        ],
      }),
    ).toThrow();
  });
});
