import { describe, expect, it } from "vitest";
import { eventBatchSchema, issueSchema, screenContextSchema, traceEventSchema } from "./events.js";

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
    const layoutHints = Array.from({ length: 51 }, (_, index) => ({
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

  it("masked 와 textMaskedOrLimited 를 동시에 실은 힌트를 거절한다", () => {
    const baseEvent = {
      eventId: "evt_masked_text",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click" as const,
      urlPath: "/settings",
    };

    const bothResult = traceEventSchema.safeParse({
      ...baseEvent,
      screenContext: {
        viewport: { width: 1440, height: 900 },
        layoutHints: [
          {
            tagName: "textarea",
            masked: true,
            textMaskedOrLimited: "고객 메모 원문",
            rect: { x: 20, y: 60, width: 400, height: 120 },
          },
        ],
      },
    });

    expect(bothResult.success).toBe(false);
  });

  it("masked 단독 또는 텍스트 단독은 그대로 통과시킨다", () => {
    const baseEvent = {
      eventId: "evt_masked_only",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click" as const,
      urlPath: "/settings",
    };

    const maskedOnlyResult = traceEventSchema.safeParse({
      ...baseEvent,
      screenContext: {
        viewport: { width: 1440, height: 900 },
        layoutHints: [
          {
            tagName: "textarea",
            masked: true,
            rect: { x: 20, y: 60, width: 400, height: 120 },
          },
        ],
      },
    });

    const textOnlyResult = traceEventSchema.safeParse({
      ...baseEvent,
      eventId: "evt_text_only",
      screenContext: {
        viewport: { width: 1440, height: 900 },
        layoutHints: [
          {
            tagName: "a",
            masked: false,
            textMaskedOrLimited: "도움말",
            rect: { x: 20, y: 200, width: 80, height: 24 },
          },
        ],
      },
    });

    expect(maskedOnlyResult.success).toBe(true);
    expect(textOnlyResult.success).toBe(true);
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

  it("내부에 슬래시가 있는 정상 경로를 허용한다", () => {
    const parsed = traceEventSchema.parse({
      ...baseEvent,
      errorSource: "/assets/vendor/checkout.js",
    });

    expect(parsed.errorSource).toBe("/assets/vendor/checkout.js");
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "/a//b.js" }).success).toBe(true);
  });

  it("선행 이중 슬래시는 의도적으로 거절한다 — 수집 단계가 접어서 넘긴다", () => {
    // 정상 경로도 이 모양이 될 수 있다(new URL("https://h//a.js").pathname === "//a.js").
    // 모양만으로 원시 protocol-relative filename 과 구분할 수 없으므로 계약은 거절하고,
    // sanitizeErrorSource 가 "/vendor/lib.js" 로 접어서 넘기는 것이 정상 경로다.
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "//vendor/lib.js" }).success).toBe(false);
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "/vendor/lib.js" }).success).toBe(true);
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
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "//host/a.js" }).success).toBe(false);
    expect(traceEventSchema.safeParse({ ...baseEvent, errorSource: "/a.js#frag" }).success).toBe(false);
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

  it("생산자가 낼 수 있는 가장 긴 오류 서명을 계약이 받는다", () => {
    // errorSignature(detect.ts)는 `${errorName} · ${errorSource}:${errorLine}` 로
    // 조립한다. 각 조각의 상한은 이 계약이 정한다 — errorName 64, 구분자 " · " 3,
    // errorSource 256, ":" 1, errorLine 은 상한이 없어(z.number().int().positive())
    // 10 진 표기가 가장 긴 값이 21 자다. 1e21 부터는 지수 표기라 오히려 짧아진다.
    // 계약 상한이 이 합보다 작으면 정상 서명이 거절된다. 자르는 것은 답이 아니다 —
    // 잘린 경로는 다른 파일을 가리킨다.
    const maxName = "E".repeat(64);
    const maxSource = `/${"a".repeat(255)}`;
    const maxLine = 999999999999999900000;
    const longest = `${maxName} · ${maxSource}:${maxLine}`;

    // 조각들이 실제로 이 계약을 통과하는 값인지부터 못박는다.
    expect(
      traceEventSchema.safeParse({ ...baseEvent, errorName: maxName, errorSource: maxSource, errorLine: maxLine })
        .success,
    ).toBe(true);
    expect(String(maxLine)).toHaveLength(21);
    expect(longest).toHaveLength(345);

    const baseIssue = {
      issueId: "issue_1",
      projectId: "proj_1",
      issueType: "error_friction" as const,
      title: "/checkout 화면에서 오류 기반 막힘이 감지되었습니다",
      summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 45,
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:00:00.000Z",
      trend: "flat" as const,
      exampleSessionIds: ["sess_1"],
      status: "new" as const,
    };

    expect(issueSchema.safeParse({ ...baseIssue, relatedErrorSignature: longest }).success).toBe(true);
    expect(issueSchema.safeParse({ ...baseIssue, relatedErrorSignature: `${longest}x` }).success).toBe(false);
  });
});

describe("issueSchema elementKey", () => {
  const baseIssue = {
    issueId: "issue__settings|abc|rage_click",
    projectId: "proj_1",
    issueType: "rage_click" as const,
    title: "제목",
    summary: "요약",
    affectedSessionsCount: 1,
    affectedUsersCount: 1,
    severityScore: 70,
    firstSeenAt: "2026-09-04T00:00:00.000Z",
    lastSeenAt: "2026-09-04T00:00:01.000Z",
    trend: "flat" as const,
    exampleSessionIds: [],
    status: "new" as const,
  };

  it("정확히 16 hex 를 받는다", () => {
    const parsed = issueSchema.parse({ ...baseIssue, elementKey: "0fd2102e520470ad" });
    expect(parsed.elementKey).toBe("0fd2102e520470ad");
  });

  it("없어도 된다 — 요소를 모르는 이슈가 있다", () => {
    expect(issueSchema.parse(baseIssue).elementKey).toBeUndefined();
  });

  // 폭이 짧은 값은 정상 값이 아니라 결함이다. elementKey() 는 hash64Hex 를 쓰므로
  // 항상 16 이고, 8 hex 가 들어왔다면 32비트 시절 지문이 새어 들어온 것이다.
  it("16 이 아닌 폭을 거절한다", () => {
    expect(() => issueSchema.parse({ ...baseIssue, elementKey: "0fd2102e" })).toThrow();
    expect(() => issueSchema.parse({ ...baseIssue, elementKey: "0fd2102e520470ad0" })).toThrow();
  });

  it("hex 가 아닌 글자를 거절한다", () => {
    expect(() => issueSchema.parse({ ...baseIssue, elementKey: "0fd2102e520470zz" })).toThrow();
  });
});

describe("screenContextSchema layoutHints 상한", () => {
  const hint = (index: number) => ({
    tagName: "div",
    rect: { x: index, y: index, width: 10, height: 10 },
    masked: true,
  });
  const context = (count: number) => ({
    viewport: { width: 1456, height: 828 },
    layoutHints: Array.from({ length: count }, (_, index) => hint(index)),
  });

  it("20개를 받는다", () => {
    const parsed = screenContextSchema.parse(context(20));
    expect(parsed.layoutHints).toHaveLength(20);
  });

  // 상한이 없으면 페이로드가 무한정 커진다. 넓히되 열어 두지는 않는다.
  it("51개를 거절한다", () => {
    expect(() => screenContextSchema.parse(context(51))).toThrow();
  });

  // 넓히는 방향이라 기존에 저장된 12개짜리 데이터가 그대로 유효해야 한다.
  it("기존 12개짜리도 그대로 통과한다", () => {
    expect(screenContextSchema.parse(context(12)).layoutHints).toHaveLength(12);
  });
});
