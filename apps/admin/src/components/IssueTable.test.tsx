import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Issue } from "@trace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueTable } from "./IssueTable.js";

expect.extend(matchers);
afterEach(cleanup);

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

describe("IssueTable", () => {
  it("심각도와 최신 발견 시각 기준으로 문제를 정렬하고 요약한다", () => {
    render(
      <IssueTable
        issues={[
          issue({ issueId: "low", title: "낮은 문제", severityScore: 20 }),
          issue({
            issueId: "critical",
            title: "긴급 문제",
            severityScore: 91,
            lastSeenAt: "2026-09-01T03:00:00.000Z",
          }),
          issue({ issueId: "warn", title: "주의 문제", severityScore: 65 }),
        ]}
      />,
    );

    expect(screen.getByText("긴급 1")).toBeInTheDocument();
    expect(screen.getByText("주의 1")).toBeInTheDocument();
    expect(screen.getByText("낮음 1")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((row) => row.textContent)).toEqual([
      expect.stringContaining("긴급 문제"),
      expect.stringContaining("주의 문제"),
      expect.stringContaining("낮은 문제"),
    ]);
  });

  it("문제 핵심 정보를 한 행에서 보여주고 행 클릭으로 상세를 연다", () => {
    const onSelectIssue = vi.fn();
    render(
      <IssueTable
        onSelectIssue={onSelectIssue}
        issues={[
          issue({
            issueId: "issue_1",
            title: "설정 저장 버튼 반복 클릭",
            summary: "저장 버튼에서 rage click이 반복됩니다.",
            severityScore: 88,
            affectedSessionsCount: 12,
            affectedUsersCount: 7,
            trend: "up",
            relatedUrlPath: "/settings",
            lastSeenAt: "2026-09-01T06:00:00.000Z",
          }),
        ]}
      />,
    );

    const row = screen.getByRole("button", { name: /설정 저장 버튼 반복 클릭/ });
    expect(within(row).getByText("88")).toBeInTheDocument();
    expect(within(row).getByText("긴급")).toBeInTheDocument();
    expect(within(row).getByText("증가")).toBeInTheDocument();
    expect(within(row).getByText("세션 12")).toBeInTheDocument();
    expect(within(row).getByText("사용자 7")).toBeInTheDocument();
    expect(within(row).getByText("/settings")).toBeInTheDocument();
    expect(within(row).getByText("마지막 발견 2026-09-01 15:00:00")).toBeInTheDocument();

    fireEvent.click(row);
    expect(onSelectIssue).toHaveBeenCalledWith(expect.objectContaining({ issueId: "issue_1" }));
  });
});
