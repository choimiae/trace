import { describe, expect, it } from "vitest";
import { eventBatchSchema } from "./events.js";
import { isSafeTraceIdentifier, isSensitiveField, redactPatterns, redactText, redactUrl } from "./privacy.js";

describe("privacy redaction", () => {
  it("redacts emails, phone numbers, and long numeric values from text", () => {
    expect(redactText("choi@example.com 초대")).toBe("[redacted] 초대");
    expect(redactText("010-1234-5678")).toBe("[redacted]");
    expect(redactText("주문번호 123456789")).toBe("주문번호 [redacted]");
    expect(redactText("멤버 초대")).toBe("멤버 초대");
  });

  it("redacts URL query values and replaces sensitive query keys", () => {
    expect(redactUrl("https://app.example.com/users/123/settings?email=choi@example.com&tab=invite")).toEqual({
      origin: "https://app.example.com",
      urlPath: "/users/:id/settings",
      urlQueryRedacted: "?redacted_param_1=[redacted]&tab=[redacted]",
      urlQueryKeys: ["redacted_param_1", "tab"],
    });
  });

  it("uses hash-router paths when the browser pathname is only root", () => {
    expect(redactUrl("https://app.example.com/#/users/123/settings?email=choi@example.com&tab=invite")).toEqual({
      origin: "https://app.example.com",
      urlPath: "/users/:id/settings",
      urlQueryRedacted: "?redacted_param_1=[redacted]&tab=[redacted]",
      urlQueryKeys: ["redacted_param_1", "tab"],
    });
  });

  it("redacts identity-like and token-like URL path segments", () => {
    expect(
      redactUrl(
        "https://app.example.com/users/choi@example.com/reset/sk_live_abcDEF/orders/550e8400-e29b-41d4-a716-446655440000",
      ).urlPath,
    ).toBe("/users/:id/reset/:id/orders/:id");
    expect(redactUrl("https://app.example.com/users/alice/settings").urlPath).toBe("/users/:id/settings");
  });

  it("produces URLs that satisfy the stored event schema", () => {
    const redactedUrl = redactUrl("https://app.example.com/users/123/settings?token=secret&filter=active");

    expect(() =>
      eventBatchSchema.parse({
        projectId: "proj_123",
        anonymousUserId: "anon_123",
        sessionId: "sess_123",
        sentAt: "2026-08-24T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: `${redactedUrl.origin}${redactedUrl.urlPath}${redactedUrl.urlQueryRedacted}`,
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_123",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: redactedUrl.urlPath,
            urlQueryRedacted: redactedUrl.urlQueryRedacted,
            metadata: {},
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects trace identifiers with sensitive token-like segments after the prefix", () => {
    expect(isSafeTraceIdentifier("evt_sk_live_secret", "evt")).toBe(false);
    expect(isSafeTraceIdentifier("sess_token_secret", "sess")).toBe(false);
    expect(isSafeTraceIdentifier("anon_123456789", "anon")).toBe(false);
    expect(isSafeTraceIdentifier("evt_abc123", "evt")).toBe(true);
  });

  it("marks sensitive form fields", () => {
    expect(isSensitiveField({ tagName: "INPUT", type: "password", name: "password", id: "password" })).toBe(true);
    expect(isSensitiveField({ tagName: "INPUT", type: "email", name: "email", id: "email" })).toBe(true);
    expect(isSensitiveField({ tagName: "BUTTON", type: "button", name: "invite", id: "invite" })).toBe(false);
  });
});

describe("redactPatterns", () => {
  it("이메일·휴대폰·9자리 이상 숫자를 지운다", () => {
    expect(redactPatterns("문의 choi@example.com 010-1234-5678 1234567890")).toBe(
      "문의 [redacted] [redacted] [redacted]",
    );
  });

  // 리플레이는 화면의 본문 텍스트를 그대로 재생한다. redactText 의 120자 자르기를
  // 그대로 쓰면 긴 문단이 조용히 잘려 재생이 원본과 달라진다.
  it("120자를 넘어도 자르지 않는다", () => {
    const long = "가".repeat(300);
    expect(redactPatterns(long)).toBe(long);
  });

  it("redactText 는 지금처럼 120자에서 자른다", () => {
    expect(redactText("가".repeat(300))).toHaveLength(120);
  });
});
