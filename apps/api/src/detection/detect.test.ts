import type { TraceEvent } from "@trace/shared";
import { describe, expect, it } from "vitest";
import { detectIssues } from "./detect";

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
});
