import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScreenContextPreview } from "./ScreenContextPreview.js";

expect.extend(matchers);
afterEach(cleanup);

describe("ScreenContextPreview", () => {
  // 실측(2026-09-14, 요소 2,465개 업무 화면): 힌트 50개 중 컨테이너 5개가 자식
  // 31개를 품고 있었다. 전부 같은 실선 테두리 + 흰 배경으로 그려져 테두리 안의
  // 테두리가 되고, "빈 박스들만 겹쳐서 가득" 해 보였다.
  //
  // 수집 쪽에서 컨테이너를 버리는 것도 시도했으나 기각했다 — div·table 로 짠
  // 화면에서 td 셀 같은 진짜 영역까지 잃어(픽스처 힌트 10개+ → 5개) 골격이
  // 통째로 날아갔다. 데이터는 정확하니 **그리는 방식**으로 푼다: 품은 상자는
  // 영역으로 표시해 묶음으로 읽히게 한다.
  it("다른 상자를 품은 힌트는 영역으로 표시한다", () => {
    const { container } = render(
      <ScreenContextPreview
        context={{
          viewport: { width: 1000, height: 700 },
          layoutHints: [
            { tagName: "div", rect: { x: 20, y: 20, width: 400, height: 200 }, masked: false },
            { tagName: "span", rect: { x: 30, y: 30, width: 100, height: 40 }, masked: false },
          ],
        }}
      />,
    );

    const boxes = Array.from(container.querySelectorAll(".screen-preview__hint"));
    const outer = boxes[0];
    const inner = boxes[1];

    expect(outer).toHaveClass("screen-preview__hint--region");
    expect(inner).not.toHaveClass("screen-preview__hint--region");
  });

  // 반대 방향 가드. 겹치기만 하고 품지 않으면 둘 다 보통 상자다 — 판정을
  // "겹치면 영역" 으로 넓히면 이 테스트가 잡는다.
  it("겹치기만 하는 상자는 영역으로 표시하지 않는다", () => {
    const { container } = render(
      <ScreenContextPreview
        context={{
          viewport: { width: 1000, height: 700 },
          layoutHints: [
            { tagName: "div", rect: { x: 20, y: 20, width: 200, height: 100 }, masked: false },
            { tagName: "div", rect: { x: 150, y: 60, width: 200, height: 100 }, masked: false },
          ],
        }}
      />,
    );

    expect(container.querySelectorAll(".screen-preview__hint--region")).toHaveLength(0);
  });

  // 미리보기는 뷰포트를 축소해 그리는데 글자는 안 줄어든다. 실측(hero, 캔버스
  // 676px / 뷰포트 1456px, 배율 0.464): 11px 글자가 실제 비율의 2.2배로 그려져,
  // 48px 짜리 메뉴 상자가 화면에서 22px 인데 5글자를 넣고 있었다. 결과는
  // "시스템설정" 이 가운데만 남아 "템설" 로 보이는 것이었다.
  //
  // 그래서 상자가 화면에서 차지하는 비율이 문턱 미만이면 글자를 안 그린다.
  // 대신 title 로 들고 있어 마우스를 올리면 온전히 보인다. 기하가 틀어지지 않는다.
  it("좁은 상자는 글자를 그리지 않고 title 로 들고 있다", () => {
    render(
      <ScreenContextPreview
        context={{
          viewport: { width: 1456, height: 828 },
          layoutHints: [
            {
              tagName: "span",
              // 48 / 1456 = 3.3% — 문턱 미만
              rect: { x: 0, y: 150, width: 48, height: 44 },
              textMaskedOrLimited: "시스템설정",
              masked: false,
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText("시스템설정")).not.toBeInTheDocument();
    expect(screen.getByTitle("시스템설정")).toBeInTheDocument();
  });

  it("넓은 상자는 글자를 그대로 그린다", () => {
    render(
      <ScreenContextPreview
        context={{
          viewport: { width: 1456, height: 828 },
          layoutHints: [
            {
              tagName: "div",
              // 640 / 1456 = 44% — 문턱 이상
              rect: { x: 408, y: 287, width: 640, height: 30 },
              textMaskedOrLimited: "기업의 지속가능한 성장을 위해",
              masked: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("기업의 지속가능한 성장을 위해")).toBeInTheDocument();
  });

  // masked 힌트는 어느 크기에서도 글자를 갖지 않는다. title 로도 새면 안 된다 —
  // 계약이 masked 힌트의 텍스트를 금지하는 이유가 그것이다.
  it("masked 힌트는 title 에도 글자를 담지 않는다", () => {
    const { container } = render(
      <ScreenContextPreview
        context={{
          viewport: { width: 1456, height: 828 },
          layoutHints: [
            {
              tagName: "input",
              rect: { x: 478, y: 371, width: 500, height: 56 },
              masked: true,
            },
          ],
        }}
      />,
    );

    expect(container.querySelector(".screen-preview__hint--masked")).not.toHaveAttribute("title");
  });

  it("renders a masked screen preview with target evidence", () => {
    render(
      <ScreenContextPreview
        context={{
          titleMasked: "설정",
          viewport: { width: 1440, height: 900 },
          target: {
            tagName: "button",
            role: "button",
            textMaskedOrLimited: "저장",
            rect: { x: 620, y: 420, width: 96, height: 40 },
          },
          layoutHints: [
            {
              tagName: "main",
              role: "main",
              textMaskedOrLimited: "설정 영역",
              rect: { x: 240, y: 96, width: 960, height: 640 },
              masked: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("설정")).toBeInTheDocument();
    expect(screen.getByText("저장")).toBeInTheDocument();
    expect(screen.getByLabelText("클릭 위치")).toBeInTheDocument();
  });

  it("renders fallback when screen context is missing", () => {
    render(<ScreenContextPreview />);

    expect(screen.getByText("화면 맥락 없음")).toBeInTheDocument();
    expect(screen.getByText("이 이벤트에는 안전한 화면 재구성 정보가 없습니다.")).toBeInTheDocument();
  });

  it("renders the canvas without a click marker when the target is omitted", () => {
    render(
      <ScreenContextPreview
        context={{
          titleMasked: "목록",
          viewport: { width: 1280, height: 800 },
          layoutHints: [],
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "화면 맥락 미리보기" })).toBeInTheDocument();
    expect(screen.queryByLabelText("클릭 위치")).not.toBeInTheDocument();
  });

  it("falls back to the event's urlPath for the title when titleMasked is missing", () => {
    render(
      <ScreenContextPreview
        context={{
          viewport: { width: 1280, height: 800 },
          layoutHints: [],
        }}
        event={{
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-01T06:00:00.000Z",
          type: "click",
          urlPath: "/reports/monthly",
          metadata: {},
        }}
      />,
    );

    expect(screen.getByText("/reports/monthly")).toBeInTheDocument();
  });
});
