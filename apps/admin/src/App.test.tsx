import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

vi.mock("./api", () => ({
  getDashboardData: async () => ({
    summary: {
      frictionScore: 82,
      affectedSessionsCount: 312,
      newIssuesCount: 14,
      resolvedOrIgnoredIssuesCount: 6,
      insight: "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다.",
      trend: [{ date: "2026-08-24", score: 82 }],
      issueTypeDistribution: [{ issueType: "rage_click", count: 4 }],
      topTargets: [{ label: "/settings", count: 42 }],
    },
    issues: [
      {
        issueId: "issue_1",
        projectId: "proj_demo",
        issueType: "rage_click",
        title: "설정 화면에서 반복 클릭",
        summary: "같은 버튼을 반복 클릭했습니다.",
        affectedSessionsCount: 42,
        affectedUsersCount: 42,
        severityScore: 82,
        firstSeenAt: "2026-08-24T00:00:00.000Z",
        lastSeenAt: "2026-08-24T00:00:00.000Z",
        trend: "up",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
      },
    ],
  }),
  getIssueDetail: async () => undefined,
  getSessionTimeline: async () => [],
}));

describe("App", () => {
  it("renders dashboard metrics and problem inbox", async () => {
    render(<App />);

    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();
    expect(await screen.findByText("막힘 점수")).toBeInTheDocument();
    expect(await screen.findByText("설정 화면에서 반복 클릭")).toBeInTheDocument();
  });
});
