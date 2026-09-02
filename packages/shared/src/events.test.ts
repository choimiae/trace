import { describe, expect, it } from "vitest";
import { eventBatchSchema, issueSchema, traceEventSchema } from "./events.js";

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
          metadata: {
            eventName: "report_export_clicked",
            feature: "report_export",
            target: "permission_button",
            metric: "api_error",
            errorType: "rage_click",
            durationMs: 20000,
            source: "auto",
          },
        },
      ],
    });

    expect(parsed.events[0]?.metadata).toEqual({
      eventName: "report_export_clicked",
      feature: "report_export",
      target: "permission_button",
      metric: "api_error",
      errorType: "rage_click",
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

  it.each([
    { eventName: "sk_live_abcdef" },
    { metric: "metric_123456789" },
    { target: "user_42_click" },
    { eventName: "checkout_token_failed" },
    { eventName: "export_secret_failed" },
    { metric: "api_key_error" },
    { target: "password_reset_button" },
    { errorType: "auth_failure" },
    { eventName: "session_started" },
    { target: "cookie_banner_clicked" },
  ])("rejects reviewer analytics identifier example: %o", (metadata) => {
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
  });

  it("rejects identity-like metadata strings and route paths", () => {
    for (const metadata of [
      { message: "sk-live-abcDEF" },
      { feature: "alice" },
      { target: "user_42" },
      { eventName: "sk-live-abcDEF" },
      { metric: "123456789" },
      { endpoint: "/users/alice" },
      { endpoint: "/123456789" },
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

describe("screenContextSchema", () => {
  it("accepts safe target rect and viewport context", () => {
    const parsed = traceEventSchema.parse({
      eventId: "evt_1",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click",
      urlPath: "/settings",
      elementRole: "button",
      elementTextMaskedOrLimited: "저장",
      screenContext: {
        titleMasked: "설정",
        viewport: { width: 1440, height: 900 },
        target: {
          tagName: "button",
          role: "button",
          textMaskedOrLimited: "저장",
          selectorHash: "abc123",
          rect: { x: 620, y: 420, width: 96, height: 40 },
        },
        layoutHints: [
          {
            tagName: "main",
            role: "main",
            textMaskedOrLimited: "설정",
            rect: { x: 240, y: 96, width: 960, height: 640 },
            masked: false,
          },
        ],
      },
    });

    expect(parsed.screenContext?.target?.rect.x).toBe(620);
  });

  it("rejects sensitive text in screen context fields", () => {
    const result = traceEventSchema.safeParse({
      eventId: "evt_2",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click",
      urlPath: "/checkout",
      screenContext: {
        viewport: { width: 390, height: 844 },
        target: {
          tagName: "button",
          role: "button",
          textMaskedOrLimited: "user@example.com",
          rect: { x: 16, y: 720, width: 180, height: 44 },
        },
        layoutHints: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects raw selector values in screen context selector hashes", () => {
    const baseEvent = {
      eventId: "evt_4",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click",
      urlPath: "/settings",
    };

    const targetResult = traceEventSchema.safeParse({
      ...baseEvent,
      screenContext: {
        viewport: { width: 1440, height: 900 },
        target: {
          tagName: "button",
          selectorHash: "button[data-email='user@example.com']",
          rect: { x: 16, y: 720, width: 180, height: 44 },
        },
        layoutHints: [],
      },
    });

    const layoutHintResult = traceEventSchema.safeParse({
      ...baseEvent,
      eventId: "evt_5",
      screenContext: {
        viewport: { width: 1440, height: 900 },
        layoutHints: [
          {
            tagName: "a",
            selectorHash: "a[href='mailto:user@example.com']",
            rect: { x: 24, y: 120, width: 240, height: 32 },
            masked: false,
          },
        ],
      },
    });

    expect(targetResult.success).toBe(false);
    expect(layoutHintResult.success).toBe(false);
  });

  it("limits layout hints to keep payloads small", () => {
    const layoutHints = Array.from({ length: 13 }, (_, index) => ({
      tagName: "button",
      role: "button",
      textMaskedOrLimited: `버튼 ${index}`,
      rect: { x: index, y: index, width: 80, height: 32 },
      masked: false,
    }));

    const result = traceEventSchema.safeParse({
      eventId: "evt_3",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click",
      urlPath: "/settings",
      screenContext: {
        viewport: { width: 1440, height: 900 },
        layoutHints,
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("issue representative event", () => {
  it("accepts a representative event with screen context", () => {
    const parsed = issueSchema.parse({
      issueId: "issue_1",
      projectId: "proj_1",
      issueType: "dead_click_cluster",
      title: "저장 버튼 반응 없음",
      summary: "설정 화면에서 저장 버튼 클릭 후 후속 이벤트가 없습니다.",
      affectedSessionsCount: 2,
      affectedUsersCount: 2,
      severityScore: 50,
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:05:00.000Z",
      trend: "flat",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      representativeEvent: {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.000Z",
        type: "click",
        urlPath: "/settings",
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
      status: "new",
    });

    expect(parsed.representativeEvent?.screenContext?.target?.textMaskedOrLimited).toBe("저장");
  });
});

describe("오류 식별자 계약", () => {
  const baseEvent = {
    eventId: "evt_abcdefghij",
    sessionId: "sess_abcdefghij",
    pageId: "page_abcdefghij",
    timestamp: "2026-09-02T01:00:00.000Z",
    type: "js_error" as const,
    urlPath: "/checkout",
    metadata: {},
  };

  it("안전한 오류 종류·경로·라인을 허용한다", () => {
    const parsed = traceEventSchema.parse({
      ...baseEvent,
      errorName: "TypeError",
      errorSource: "/assets/checkout.js",
      errorLine: 412,
    });

    expect(parsed.errorName).toBe("TypeError");
    expect(parsed.errorSource).toBe("/assets/checkout.js");
    expect(parsed.errorLine).toBe(412);
  });

  it("오류 필드가 없어도 통과한다", () => {
    const parsed = traceEventSchema.parse(baseEvent);

    expect(parsed).not.toHaveProperty("errorName");
    expect(parsed).not.toHaveProperty("errorSource");
    expect(parsed).not.toHaveProperty("errorLine");
  });

  it("메시지가 섞인 오류 종류를 거절한다", () => {
    expect(
      traceEventSchema.safeParse({
        ...baseEvent,
        errorName: "TypeError: Cannot read property 'id' of undefined",
      }).success,
    ).toBe(false);
  });

  it("경로가 아닌 스크립트 값과 쿼리가 붙은 값을 거절한다", () => {
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "https://app.example.com/a.js" }).success).toBe(false);
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "/a.js?token=abc" }).success).toBe(false);
  });

  it("0 이하 또는 소수 라인을 거절한다", () => {
    expect(traceEventSchema.safeParse({ ...baseEvent, errorLine: 0 }).success).toBe(false);
    expect(traceEventSchema.safeParse({ ...baseEvent, errorLine: 12.5 }).success).toBe(false);
  });

  it("이슈에 오류 서명을 허용한다", () => {
    const parsed = issueSchema.parse({
      issueId: "issue_1",
      projectId: "proj_1",
      issueType: "error_friction",
      title: "/checkout 화면에서 오류 기반 막힘이 감지되었습니다",
      summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 45,
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:00:00.000Z",
      trend: "flat",
      exampleSessionIds: ["sess_1"],
      status: "new",
      relatedErrorSignature: "TypeError · /assets/checkout.js:412",
    });

    expect(parsed.relatedErrorSignature).toBe("TypeError · /assets/checkout.js:412");
  });
});
