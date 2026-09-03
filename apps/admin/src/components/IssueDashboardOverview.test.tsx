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
    // 대표 문제의 제목·요약·경로는 히어로가 이미 말한다. 한눈에 보기 카드는
    // 점수·상태·추세 지표만 남긴다.
    expect(within(overview).getAllByText("설정 저장 버튼 반복 클릭")).toHaveLength(1);
    expect(within(overview).getByText("92")).toBeInTheDocument();
    expect(within(overview).getByText("최근 발견 2026-09-01 15:00:00")).toBeInTheDocument();
    expect(within(overview).getByText("문제가 많은 화면")).toBeInTheDocument();
    expect(within(overview).getAllByText("/settings")).toHaveLength(1);
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

  it("shows a screen-first friction summary for the top issue without duplicating the screen name", () => {
    render(
      <IssueDashboardOverview
        summary={summary}
        issues={[
          issue({
            issueId: "issue_1",
            title: "/settings 화면에서 반복 클릭이 감지되었습니다",
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
    const heading = screen.getByText("설정 화면에서 반복 클릭이 감지되었습니다");
    expect(heading).toBeInTheDocument();
    expect(heading).not.toHaveTextContent("/settings");
    expect(screen.getByLabelText("화면 맥락 미리보기")).toBeInTheDocument();
    expect(screen.getByText("다음 액션")).toBeInTheDocument();

    const hero = screen.getByRole("region", { name: "가장 먼저 볼 사용자 막힘" });
    expect(within(hero).getByLabelText("클릭 위치")).toBeInTheDocument();
    // 문장(1) 이 미리보기(2) 보다 먼저 읽혀야 한다. 좁은 화면에서 한 열이 되면
    // DOM 순서가 곧 읽는 순서다.
    const preview = within(hero).getByLabelText("화면 맥락 미리보기");
    expect(heading.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("대표 문제 카드는 제목을 지우고도 상세 열기 버튼을 유지한다", () => {
    const onSelectIssue = vi.fn();
    render(
      <IssueDashboardOverview
        summary={summary}
        onSelectIssue={onSelectIssue}
        issues={[
          issue({
            issueId: "critical",
            title: "설정 저장 버튼 반복 클릭",
            summary: "저장 버튼에서 rage click이 반복됩니다.",
            severityScore: 92,
            relatedUrlPath: "/settings",
          }),
        ]}
      />,
    );

    const overview = screen.getByRole("region", { name: "문제 한눈에 보기" });
    expect(within(overview).queryByText("지금 먼저 볼 문제")).not.toBeInTheDocument();
    expect(within(overview).queryByText("저장 버튼에서 rage click이 반복됩니다.")).not.toBeInTheDocument();

    fireEvent.click(within(overview).getByRole("button", { name: "설정 저장 버튼 반복 클릭 보기" }));

    expect(onSelectIssue).toHaveBeenCalledWith(expect.objectContaining({ issueId: "critical" }));
  });

  it("화면 이름에 치환 패턴($&)이 있어도 경로를 되살리지 않는다", () => {
    render(
      <IssueDashboardOverview
        summary={summary}
        issues={[
          issue({
            issueId: "issue_dollar",
            title: "/settings 화면에서 반복 클릭이 감지되었습니다",
            relatedUrlPath: "/settings",
            representativeEvent: {
              eventId: "evt_1",
              sessionId: "sess_1",
              pageId: "page_1",
              timestamp: "2026-09-02T01:00:00.000Z",
              type: "click",
              urlPath: "/settings",
              metadata: {},
              screenContext: {
                titleMasked: "설정$&",
                viewport: { width: 1440, height: 900 },
                layoutHints: [],
              },
            },
          }),
        ]}
      />,
    );

    const heading = screen.getByRole("heading", { level: 2, name: /설정/ });
    expect(heading).toHaveTextContent("설정$& 화면에서 반복 클릭이 감지되었습니다");
    expect(heading).not.toHaveTextContent("/settings");
  });

  it("renders the issue title unchanged when the representative event has no masked screen name", () => {
    render(
      <IssueDashboardOverview
        summary={summary}
        issues={[
          issue({
            issueId: "issue_2",
            title: "/reports 화면에서 오류 기반 막힘이 감지되었습니다",
            relatedUrlPath: "/reports",
            representativeEvent: {
              eventId: "evt_2",
              sessionId: "sess_2",
              pageId: "page_2",
              timestamp: "2026-09-02T01:00:00.000Z",
              type: "js_error",
              urlPath: "/reports",
              metadata: {},
              screenContext: {
                viewport: { width: 1280, height: 800 },
                layoutHints: [],
              },
            },
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "/reports 화면에서 오류 기반 막힘이 감지되었습니다" }),
    ).toBeInTheDocument();
  });

  it("근거를 항목별 표로 보여주고 오류 서명을 포함한다", () => {
    render(
      <IssueDashboardOverview
        summary={summary}
        issues={[
          issue({
            issueId: "err",
            issueType: "error_friction",
            title: "/checkout 화면에서 오류 기반 막힘이 감지되었습니다",
            severityScore: 90,
            relatedUrlPath: "/checkout",
            affectedSessionsCount: 58,
            affectedUsersCount: 41,
            lastSeenAt: "2026-09-02T01:00:00.000Z",
            relatedErrorSignature: "TypeError · /assets/checkout.js:412",
            representativeEvent: {
              eventId: "evt_1",
              sessionId: "sess_1",
              pageId: "page_1",
              timestamp: "2026-09-02T01:00:00.000Z",
              type: "click",
              urlPath: "/checkout",
              metadata: {},
              screenContext: {
                viewport: { width: 1440, height: 900 },
                target: {
                  tagName: "button",
                  role: "button",
                  textMaskedOrLimited: "결제하기",
                  rect: { x: 620, y: 420, width: 96, height: 40 },
                },
                layoutHints: [],
              },
            },
          }),
        ]}
      />,
    );
    const hero = screen.getByRole("region", { name: "가장 먼저 볼 사용자 막힘" });
    const factsTable = hero.querySelector(".friction-hero__facts") as HTMLElement;

    expect(within(hero).getByText("화면")).toBeInTheDocument();
    expect(within(factsTable).getByText("/checkout")).toBeInTheDocument();
    // 대표 이벤트는 이슈가 아니라 세션으로 고르므로(findRepresentativeEvent) 이
    // 클릭이 이 이슈의 클릭이라고 말할 수 없다. 라벨은 데이터가 뒷받침하는 것,
    // 즉 "같은 화면에서 일어난 클릭"까지만 말한다.
    expect(within(hero).getByText("화면 내 클릭")).toBeInTheDocument();
    expect(within(hero).queryByText("클릭")).not.toBeInTheDocument();
    expect(within(hero).getByText(/button/)).toBeInTheDocument();
    expect(within(hero).getByText("패턴")).toBeInTheDocument();
    expect(within(hero).getByText("오류 마찰")).toBeInTheDocument();
    expect(within(hero).getByText("오류")).toBeInTheDocument();
    expect(within(hero).getByText("TypeError · /assets/checkout.js:412")).toBeInTheDocument();
    expect(within(hero).getByText("영향")).toBeInTheDocument();
    // hero 안 점수 필
    expect(within(hero).getByText("90")).toBeInTheDocument();
    // 다음 액션의 dt/dd 는 유효한 dl 안에 있어야 한다 (dl 밖 dt/dd 는 잘못된 HTML).
    expect(within(hero).getByText("다음 액션").closest("dl")).not.toBeNull();
  });

  it("오류 서명이 없으면 오류 행을 숨긴다", () => {
    render(
      <IssueDashboardOverview
        summary={summary}
        issues={[issue({ issueId: "plain", issueType: "rage_click", severityScore: 70 })]}
      />,
    );
    const hero = screen.getByRole("region", { name: "가장 먼저 볼 사용자 막힘" });

    expect(within(hero).queryByText("오류")).not.toBeInTheDocument();
    expect(within(hero).getByText("패턴")).toBeInTheDocument();
  });
});
