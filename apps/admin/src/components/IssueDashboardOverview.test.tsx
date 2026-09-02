import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DashboardSummary, Issue } from "@trace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueDashboardOverview } from "./IssueDashboardOverview.js";

expect.extend(matchers);
afterEach(cleanup);

const summary: DashboardSummary = {
  frictionScore: 82,
  affectedSessionsCount: 312,
  newIssuesCount: 14,
  resolvedOrIgnoredIssuesCount: 6,
  totalEventsCount: 128,
  insight: "설정 화면에서 반복 클릭이 증가했습니다.",
  trend: [],
  issueTypeDistribution: [
    { issueType: "rage_click", count: 6 },
    { issueType: "dead_click_cluster", count: 4 },
  ],
  topTargets: [
    { label: "/settings", count: 8 },
    { label: "/checkout", count: 5 },
  ],
};

const issue = (overrides: Partial<Issue>): Issue => ({
  issueId: "issue_base",
  projectId: "proj_demo",
  issueType: "rage_click",
  title: "기본 문제",
  summary: "요약",
  affectedSessionsCount: 1,
  affectedUsersCount: 1,
  severityScore: 10,
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-01T00:00:00.000Z",
  trend: "flat",
  relatedUrlPath: "/",
  exampleSessionIds: ["sess_1"],
  status: "new",
  ...overrides,
});

describe("IssueDashboardOverview", () => {
  it("가장 심각한 문제와 주요 분포를 한 화면에 보여준다", () => {
    render(
      <IssueDashboardOverview
        summary={summary}
        issues={[
          issue({ issueId: "low", title: "낮은 문제", severityScore: 20 }),
          issue({
            issueId: "critical",
            title: "설정 저장 버튼 반복 클릭",
            summary: "저장 버튼에서 rage click이 반복됩니다.",
            severityScore: 92,
            affectedSessionsCount: 18,
            affectedUsersCount: 12,
            trend: "up",
            relatedUrlPath: "/settings",
            lastSeenAt: "2026-09-01T06:00:00.000Z",
          }),
        ]}
      />,
    );

    const overview = screen.getByRole("region", { name: "문제 한눈에 보기" });
    expect(within(overview).getByText("지금 먼저 볼 문제")).toBeInTheDocument();
    expect(within(overview).getAllByText("설정 저장 버튼 반복 클릭")).toHaveLength(2);
    expect(within(overview).getByText("92")).toBeInTheDocument();
    expect(within(overview).getByText("최근 발견 2026-09-01 15:00:00")).toBeInTheDocument();
    expect(within(overview).getByText("문제가 많은 화면")).toBeInTheDocument();
    expect(within(overview).getAllByText("/settings")).toHaveLength(2);
    expect(within(overview).getByText("문제 원인")).toBeInTheDocument();
    expect(within(overview).getByText("분노 클릭")).toBeInTheDocument();
    expect(within(overview).getByText("최근 발견")).toBeInTheDocument();
  });

  it("행 클릭으로 가장 심각한 문제 상세를 연다", () => {
    const onSelectIssue = vi.fn();
    render(
      <IssueDashboardOverview
        summary={summary}
        onSelectIssue={onSelectIssue}
        issues={[
          issue({
            issueId: "critical",
            title: "설정 저장 버튼 반복 클릭",
            severityScore: 92,
            lastSeenAt: "2026-09-01T06:00:00.000Z",
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "설정 저장 버튼 반복 클릭 보기" }));

    expect(onSelectIssue).toHaveBeenCalledWith(expect.objectContaining({ issueId: "critical" }));
  });

  it("shows a screen-first friction summary for the top issue", () => {
    render(
      <IssueDashboardOverview
        summary={summary}
        issues={[
          issue({
            issueId: "issue_1",
            title: "저장 버튼 반응 없음",
            summary: "설정 화면에서 저장 버튼 클릭 후 후속 이벤트가 없습니다.",
            severityScore: 80,
            relatedUrlPath: "/settings",
            exampleSessionIds: ["sess_1"],
            representativeEvent: {
              eventId: "evt_1",
              sessionId: "sess_1",
              pageId: "page_1",
              timestamp: "2026-09-02T01:00:00.000Z",
              type: "click",
              urlPath: "/settings",
              metadata: {},
              screenContext: {
                titleMasked: "설정",
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
          }),
        ]}
      />,
    );

    expect(screen.getByText("가장 먼저 볼 사용자 막힘")).toBeInTheDocument();
    expect(screen.getByText("설정 화면에서 저장 버튼 반응 없음")).toBeInTheDocument();
    expect(screen.getByLabelText("화면 맥락 미리보기")).toBeInTheDocument();
    expect(screen.getByText("다음 액션")).toBeInTheDocument();
  });
});
