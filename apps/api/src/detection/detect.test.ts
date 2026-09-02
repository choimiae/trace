import type { TraceEvent } from "@trace/shared";
import { describe, expect, it } from "vitest";
import { detectIssues } from "./detect.js";

function click(partial: Partial<TraceEvent>): TraceEvent {
  return {
    eventId: partial.eventId ?? "evt",
    sessionId: partial.sessionId ?? "sess_1",
    pageId: "page_1",
    timestamp: partial.timestamp ?? "2026-08-24T00:00:00.000Z",
    type: partial.type ?? "click",
    urlPath: partial.urlPath ?? "/settings",
    elementSelectorHash: partial.elementSelectorHash ?? "button_hash",
    elementRole: "button",
    elementTextMaskedOrLimited: "권한 추가",
    metadata: partial.metadata ?? {},
  };
}

describe("detectIssues", () => {
  it("detects rage clicks on the same element within three seconds", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T00:00:05.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({ eventId: "evt_2", timestamp: "2026-08-24T00:00:01.000Z" }),
        click({ eventId: "evt_3", timestamp: "2026-08-24T00:00:02.000Z" }),
      ],
    });

    expect(issues[0]).toMatchObject({
      issueType: "rage_click",
      relatedUrlPath: "/settings",
      severityScore: 70,
    });
  });

  it("sets issue first and last seen times from matching event occurrences", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T12:00:00.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({ eventId: "evt_2", timestamp: "2026-08-24T00:00:01.000Z" }),
        click({ eventId: "evt_3", timestamp: "2026-08-24T00:00:02.000Z" }),
        click({ eventId: "evt_4", timestamp: "2026-08-24T01:00:00.000Z" }),
        click({ eventId: "evt_5", timestamp: "2026-08-24T01:00:01.000Z" }),
        click({ eventId: "evt_6", timestamp: "2026-08-24T01:00:02.000Z" }),
      ],
    });

    expect(issues[0]).toMatchObject({
      issueType: "rage_click",
      firstSeenAt: "2026-08-24T00:00:00.000Z",
      lastSeenAt: "2026-08-24T01:00:02.000Z",
    });
  });

  it("detects dead clicks when a click is followed by no response event", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T00:00:05.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({ eventId: "evt_2", type: "idle", timestamp: "2026-08-24T00:00:03.000Z", metadata: { durationMs: 3000 } }),
      ],
    });

    expect(issues.some((issue) => issue.issueType === "dead_click_cluster")).toBe(true);
  });

  it("detects long pause after a click", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T00:00:30.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({
          eventId: "evt_2",
          type: "idle",
          timestamp: "2026-08-24T00:00:20.000Z",
          metadata: { durationMs: 20000 },
        }),
      ],
    });

    expect(issues.some((issue) => issue.issueType === "long_pause")).toBe(true);
  });

  it("detects error friction after a click", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T00:00:05.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({
          eventId: "evt_2",
          type: "js_error",
          timestamp: "2026-08-24T00:00:04.000Z",
          metadata: { errorType: "js_error" },
        }),
      ],
    });

    expect(issues.some((issue) => issue.issueType === "error_friction")).toBe(true);
  });

  it("오류 이벤트에서 오류 서명을 조립한다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-02T01:00:10.000Z",
      events: [
        {
          eventId: "evt_err",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "js_error",
          urlPath: "/checkout",
          errorName: "TypeError",
          errorSource: "/assets/checkout.js",
          errorLine: 412,
          metadata: {},
        },
      ],
    });
    const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

    expect(errorIssue?.relatedErrorSignature).toBe("TypeError · /assets/checkout.js:412");
  });

  it("부분 정보만 있으면 있는 값으로만 서명을 만든다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-02T01:00:10.000Z",
      events: [
        {
          eventId: "evt_err",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "js_error",
          urlPath: "/checkout",
          errorName: "RangeError",
          metadata: {},
        },
      ],
    });
    const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

    expect(errorIssue?.relatedErrorSignature).toBe("RangeError");
  });

  it("오류 식별자가 없으면 서명을 넣지 않는다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-02T01:00:10.000Z",
      events: [
        {
          eventId: "evt_err",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "js_error",
          urlPath: "/checkout",
          metadata: {},
        },
      ],
    });
    const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

    expect(errorIssue).toBeDefined();
    expect(errorIssue).not.toHaveProperty("relatedErrorSignature");
  });

  it("같은 이슈로 병합될 때 서명이 있는 발생 건의 서명을 보존한다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-02T01:00:10.000Z",
      events: [
        {
          eventId: "evt_no_sig",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "js_error",
          urlPath: "/checkout",
          metadata: {},
        },
        {
          eventId: "evt_with_sig",
          sessionId: "sess_2",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:01.000Z",
          type: "js_error",
          urlPath: "/checkout",
          errorName: "TypeError",
          errorSource: "/assets/checkout.js",
          errorLine: 412,
          metadata: {},
        },
      ],
    });
    const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

    expect(errorIssue?.affectedSessionsCount).toBe(2);
    expect(errorIssue?.relatedErrorSignature).toBe("TypeError · /assets/checkout.js:412");
  });
});
