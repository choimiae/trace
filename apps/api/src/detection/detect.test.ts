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
    elementSelectorHash: "elementSelectorHash" in partial ? partial.elementSelectorHash : "button_hash",
    elementRole: "button",
    elementTextMaskedOrLimited: partial.elementTextMaskedOrLimited ?? "권한 추가",
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

  it("같은 이슈로 병합될 때 가장 최근 발생 건의 서명을 남긴다", () => {
    // 오류 이벤트에는 요소 정보가 없어 같은 경로의 모든 오류가 한 이슈로 접힌다.
    // 가장 오래된 서명이 영구히 남으면 이미 고친 오류의 이름이 대시보드에 계속
    // 뜨고, 그 아래 쌓이는 새 오류는 이름을 얻지 못한다.
    const older = {
      eventId: "evt_older",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "js_error" as const,
      urlPath: "/checkout",
      errorName: "TypeError",
      errorSource: "/assets/checkout.js",
      errorLine: 412,
      metadata: {},
    };
    const newer = {
      eventId: "evt_newer",
      sessionId: "sess_2",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:30.000Z",
      type: "js_error" as const,
      urlPath: "/checkout",
      errorName: "RangeError",
      errorSource: "/assets/cart.js",
      errorLine: 88,
      metadata: {},
    };
    // 병합은 배열 순서가 아니라 발생 시각으로 결정돼야 한다. 두 입력 순서 모두에서
    // 같은 답이 나와야 한다.
    const signatures = [
      [older, newer],
      [newer, older],
    ].map(
      (events) =>
        detectIssues({ projectId: "proj_1", now: "2026-09-02T01:01:00.000Z", events }).find(
          (issue) => issue.issueType === "error_friction",
        )?.relatedErrorSignature,
    );

    expect(signatures).toEqual(["RangeError · /assets/cart.js:88", "RangeError · /assets/cart.js:88"]);
  });

  it("최근 발생 건에 서명이 없으면 서명이 있는 예전 발생 건의 서명을 유지한다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-02T01:01:00.000Z",
      events: [
        {
          eventId: "evt_with_sig",
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
        {
          eventId: "evt_no_sig",
          sessionId: "sess_2",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:30.000Z",
          type: "js_error",
          urlPath: "/checkout",
          metadata: {},
        },
      ],
    });
    const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

    expect(errorIssue?.relatedErrorSignature).toBe("TypeError · /assets/checkout.js:412");
  });

  it("서명 후보가 아예 없으면 서명 필드를 만들지 않는다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-02T01:01:00.000Z",
      events: [
        {
          eventId: "evt_a",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "js_error",
          urlPath: "/checkout",
          metadata: {},
        },
        {
          eventId: "evt_b",
          sessionId: "sess_2",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:30.000Z",
          type: "js_error",
          urlPath: "/checkout",
          metadata: {},
        },
      ],
    });
    const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

    expect(errorIssue?.affectedSessionsCount).toBe(2);
    expect(errorIssue).not.toHaveProperty("relatedErrorSignature");
  });

  it("서명 조립은 null 같은 빈 값을 조각으로 세지 않는다", () => {
    // SqliteStore.toEvent 가 null 을 걷어내므로 오늘은 닿지 않는 경로다. 다만
    // 가드가 undefined 만 보면 다른 저장소·직렬화 경로에서 " · /assets/cart.js:88"
    // 처럼 앞이 빈 서명이 나온다.
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-02T01:01:00.000Z",
      events: [
        {
          eventId: "evt_null_name",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "js_error",
          urlPath: "/checkout",
          errorName: null as unknown as string,
          errorSource: "/assets/cart.js",
          errorLine: 88,
          metadata: {},
        },
      ],
    });
    const errorIssue = issues.find((issue) => issue.issueType === "error_friction");

    expect(errorIssue?.relatedErrorSignature).toBe("/assets/cart.js:88");
  });
});

describe("요소 신원", () => {
  // 구조·속성이 같은 형제 버튼을 흉내낸다. SDK 는 이런 경우 같은 지문을 낸다.
  const SIBLING_HASH = "aaaaaaaabbbbbbbb";

  function siblingClick(eventId: string, timestamp: string, text: string): TraceEvent {
    return click({ eventId, timestamp, elementSelectorHash: SIBLING_HASH, elementTextMaskedOrLimited: text });
  }

  it("구조가 같고 글자만 다른 클릭은 분노 클릭으로 뭉치지 않는다", () => {
    // 서로 다른 두 버튼을 각각 2번. 어느 쪽도 3회 문턱을 넘지 않는다.
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-03T01:00:05.000Z",
      events: [
        siblingClick("evt_1", "2026-09-03T01:00:00.000Z", "리포트 내보내기"),
        siblingClick("evt_2", "2026-09-03T01:00:00.400Z", "오류 발생"),
        siblingClick("evt_3", "2026-09-03T01:00:00.800Z", "리포트 내보내기"),
        siblingClick("evt_4", "2026-09-03T01:00:01.200Z", "오류 발생"),
      ],
    });

    expect(issues.filter((issue) => issue.issueType === "rage_click")).toHaveLength(0);
  });

  it("글자까지 같은 클릭은 여전히 분노 클릭으로 잡는다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-03T01:00:05.000Z",
      events: [
        siblingClick("evt_1", "2026-09-03T01:00:00.000Z", "오류 발생"),
        siblingClick("evt_2", "2026-09-03T01:00:00.400Z", "오류 발생"),
        siblingClick("evt_3", "2026-09-03T01:00:00.800Z", "오류 발생"),
      ],
    });

    expect(issues.filter((issue) => issue.issueType === "rage_click")).toHaveLength(1);
  });

  it("한글 글자가 이슈 id 에서 뭉개지지 않는다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-03T01:00:30.000Z",
      events: [
        siblingClick("evt_1", "2026-09-03T01:00:00.000Z", "저장"),
        siblingClick("evt_2", "2026-09-03T01:00:10.000Z", "오류 발생"),
      ],
    });

    const deadClickIds = issues
      .filter((issue) => issue.issueType === "dead_click_cluster")
      .map((issue) => issue.issueId);

    expect(deadClickIds).toHaveLength(2);
    expect(new Set(deadClickIds).size).toBe(2);
  });

  it("오류 이슈의 id 는 여전히 page 슬롯을 쓴다", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-09-03T01:00:05.000Z",
      events: [
        click({
          eventId: "evt_err",
          type: "js_error",
          timestamp: "2026-09-03T01:00:00.000Z",
          elementSelectorHash: undefined,
        }),
      ],
    });

    const error = issues.find((issue) => issue.issueType === "error_friction");
    // 부분 문자열 포함 검사(toContain("|page|"))는 쓰지 않는다. urlPath 안의 `|` 는
    // issueTargetKey 의 허용 문자셋에 들어 있어 치환되지 않으므로, 지문 키로 지어진
    // id 에도 "|page|" 가 우연히 나타날 수 있다 — 마이그레이션 작업이 바로 그 이유로
    // 이 패턴을 버리고 접미사 정확 비교로 갔다. 여기서도 꼬리 전체를 끝에 붙여 본다.
    expect(error?.issueId).toMatch(/\|page\|error_friction$/);
  });
});
