import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Issue } from "@trace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPage } from "./IssueDetailPage.js";

expect.extend(matchers);
afterEach(cleanup);

vi.mock("../api.js", () => ({
  getSessionTimeline: vi.fn().mockResolvedValue([]),
}));

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

const representativeEvent = {
  eventId: "evt_1",
  sessionId: "sess_1",
  pageId: "page_1",
  timestamp: "2026-09-01T06:00:00.000Z",
  type: "click" as const,
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
};

describe("IssueDetailPage", () => {
  it("대표 화면 맥락을 별도 팝업 없이 보여주고 세션 타임라인을 유지한다", async () => {
    render(<IssueDetailPage issue={issue({ representativeEvent })} onClose={vi.fn()} />);

    const context = await screen.findByRole("region", { name: "대표 화면 맥락" });
    expect(within(context).getByLabelText("클릭 위치")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("세션 타임라인")).toBeInTheDocument();
  });

  it("대표 이벤트가 없으면 화면 맥락 영역을 보여주지 않는다", async () => {
    render(<IssueDetailPage issue={issue({})} onClose={vi.fn()} />);

    expect(await screen.findByText("세션 타임라인")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "대표 화면 맥락" })).not.toBeInTheDocument();
  });
});
