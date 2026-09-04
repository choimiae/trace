import type { Issue } from "@trace/shared";
import { describe, expect, it } from "vitest";
import { buildDashboardSummary } from "./dashboard-summary.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    issueId: "issue__|abcd|rage_click",
    projectId: "proj_1",
    issueType: "rage_click",
    title: "제목",
    summary: "요약",
    affectedSessionsCount: 1,
    affectedUsersCount: 1,
    severityScore: 80,
    firstSeenAt: "2026-09-04T00:00:00.000Z",
    lastSeenAt: "2026-09-04T00:00:01.000Z",
    trend: "flat",
    relatedUrlPath: "/settings",
    exampleSessionIds: [],
    status: "new",
    ...overrides,
  };
}

describe("buildDashboardSummary insight", () => {
  // 이 문장은 서버가 완성해서 내려주므로 관리자 화면에서 이름만 갈아끼울 수 없다.
  // 여기서 원시 enum 을 넣으면 그대로 사용자에게 보인다.
  it("이슈 유형을 원시 enum 이 아니라 사람이 읽는 이름으로 적는다", () => {
    const summary = buildDashboardSummary([makeIssue({ issueType: "rage_click" })], 10);

    expect(summary.insight).toBe("/settings에서 분노 클릭 문제가 가장 크게 나타났습니다.");
    expect(summary.insight).not.toContain("rage_click");
  });

  it("긴 enum 이름을 가진 유형도 마찬가지다", () => {
    const summary = buildDashboardSummary([makeIssue({ issueType: "dead_click_cluster" })], 10);

    expect(summary.insight).toBe("/settings에서 반응 없는 클릭 문제가 가장 크게 나타났습니다.");
    expect(summary.insight).not.toContain("dead_click_cluster");
  });

  it("활성 이슈가 없으면 유형 이름을 쓰지 않는다", () => {
    const summary = buildDashboardSummary([makeIssue({ status: "resolved" })], 10);

    expect(summary.insight).toBe("아직 감지된 사용자 막힘이 없습니다.");
  });
});
