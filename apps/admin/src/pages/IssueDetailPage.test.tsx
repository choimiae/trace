import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    // 상세 자체가 다이얼로그가 됐다. 화면 맥락이 그 안에서 팝업을 또 열지
    // 않는다는 것이 이 테스트의 원래 의도다.
    expect(within(context).queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("세션 타임라인")).toBeInTheDocument();
  });

  it("대표 이벤트가 없으면 화면 맥락 영역을 보여주지 않는다", async () => {
    render(<IssueDetailPage issue={issue({})} onClose={vi.fn()} />);

    expect(await screen.findByText("세션 타임라인")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "대표 화면 맥락" })).not.toBeInTheDocument();
  });

  // 드로어(오른쪽 패널)에서 화면 대부분을 덮는 다이얼로그로 바꿨다. 뒤를 가린
  // 배경을 누르면 닫히는 것이 이런 팝업의 기본 동작이다.
  it("다이얼로그로 열린다", () => {
    render(<IssueDetailPage issue={issue({})} onClose={() => undefined} />);

    const dialog = screen.getByRole("dialog", { name: "문제 상세" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("가려진 배경을 누르면 닫는다", () => {
    const onClose = vi.fn();
    const { container } = render(<IssueDetailPage issue={issue({})} onClose={onClose} />);

    fireEvent.click(container.querySelector(".detail-backdrop") as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 안쪽을 누르다 배경까지 이벤트가 번지면 읽던 중에 닫힌다.
  it("다이얼로그 안을 누르면 닫지 않는다", () => {
    const onClose = vi.fn();
    render(<IssueDetailPage issue={issue({})} onClose={onClose} />);

    fireEvent.click(screen.getByRole("dialog", { name: "문제 상세" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape 로 닫는다", () => {
    const onClose = vi.fn();
    render(<IssueDetailPage issue={issue({})} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
