import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenContextPreview } from "./ScreenContextPreview.js";

expect.extend(matchers);
afterEach(cleanup);

describe("ScreenContextPreview", () => {
  const hintContext = {
    viewport: { width: 1456, height: 828 },
    layoutHints: [
      {
        tagName: "span",
        // 48 / 1456 = 3.3% — 예전 문턱 미만이라 안 보이던 것
        rect: { x: 0, y: 150, width: 48, height: 44 },
        textMaskedOrLimited: "시스템설정",
        masked: false,
      },
      {
        tagName: "div",
        // 640 / 1456 = 44% — 예전 문턱 이상이라 보이던 것
        rect: { x: 408, y: 287, width: 640, height: 30 },
        textMaskedOrLimited: "기업의 지속가능한 성장을 위해",
        masked: false,
      },
    ],
  };

  // 상자 안에 글자를 넣지 않기로 했다. 넣으려 하면 뷰포트를 축소해 그리는
  // 미리보기에서 글자만 안 줄어 "시스템설정" 이 "템설" 로 읽혔다. 이제는
  // 크기로 고르지 않고 스위치로 전부 보이거나 전부 숨긴다.
  it("글자 보기가 꺼져 있으면 크기와 무관하게 글자를 그리지 않는다", () => {
    render(<ScreenContextPreview context={hintContext} />);

    expect(screen.queryByText("시스템설정")).not.toBeInTheDocument();
    expect(screen.queryByText("기업의 지속가능한 성장을 위해")).not.toBeInTheDocument();
  });

  it("글자 보기가 꺼져 있어도 title 로는 들고 있다", () => {
    render(<ScreenContextPreview context={hintContext} />);

    expect(screen.getByTitle("시스템설정")).toBeInTheDocument();
  });

  it("글자 보기를 켜면 크기와 무관하게 전부 그린다", () => {
    render(<ScreenContextPreview context={hintContext} showLabels />);

    expect(screen.getByText("시스템설정")).toBeInTheDocument();
    expect(screen.getByText("기업의 지속가능한 성장을 위해")).toBeInTheDocument();
  });

  // 340px 짜리 타임라인 미리보기에서는 라벨 간격이 11px 인데 글자 높이가
  // 14px 이라 세로로도 겹쳐 덩어리가 된다. 배치만 보여준다.
  it("compact 는 켜도 글자를 그리지 않는다", () => {
    render(<ScreenContextPreview context={hintContext} showLabels compact />);

    expect(screen.queryByText("시스템설정")).not.toBeInTheDocument();
  });

  it("compact 에는 스위치를 두지 않는다", () => {
    render(
      <ScreenContextPreview context={hintContext} compact onToggleLabels={() => undefined} />,
    );

    expect(screen.queryByLabelText("글자 보기")).not.toBeInTheDocument();
  });

  it("핸들러를 받으면 스위치를 그리고 누르면 뒤집어 알린다", () => {
    const onToggleLabels = vi.fn();
    render(<ScreenContextPreview context={hintContext} onToggleLabels={onToggleLabels} />);

    fireEvent.click(screen.getByLabelText("글자 보기"));

    expect(onToggleLabels).toHaveBeenCalledWith(true);
  });

  it("핸들러가 없으면 스위치를 그리지 않는다", () => {
    render(<ScreenContextPreview context={hintContext} />);

    expect(screen.queryByLabelText("글자 보기")).not.toBeInTheDocument();
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

  it("클릭한 요소의 글자는 스위치와 무관하게 남는다", () => {
    const context = {
      viewport: { width: 1440, height: 900 },
      target: {
        tagName: "button",
        role: "button",
        textMaskedOrLimited: "저장",
        rect: { x: 620, y: 420, width: 96, height: 40 },
      },
      layoutHints: [],
    };

    const { rerender } = render(<ScreenContextPreview context={context} />);
    expect(screen.getByText("저장")).toBeInTheDocument();

    rerender(<ScreenContextPreview context={context} showLabels />);
    expect(screen.getByText("저장")).toBeInTheDocument();
  });
});
