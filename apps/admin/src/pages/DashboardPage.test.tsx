import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage.js";

expect.extend(matchers);
afterEach(cleanup);

const summary = {
  frictionScore: 82,
  affectedSessionsCount: 312,
  newIssuesCount: 14,
  resolvedOrIgnoredIssuesCount: 6,
  totalEventsCount: 128,
  insight: "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다.",
  trend: [],
  issueTypeDistribution: [],
  topTargets: [],
};

describe("DashboardPage", () => {
  it("인사이트 상태를 글자 라벨과 함께 보여준다", () => {
    render(
      <DashboardPage
        summary={summary}
        issues={[]}
        userEmail="admin@example.com"
        onLogout={vi.fn()}
        onShowInstall={vi.fn()}
      />,
    );
    expect(screen.getByText("심각")).toBeInTheDocument();
    expect(screen.getByText(summary.insight)).toBeInTheDocument();
  });
});
