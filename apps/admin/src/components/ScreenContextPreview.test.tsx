import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScreenContextPreview } from "./ScreenContextPreview.js";

expect.extend(matchers);
afterEach(cleanup);

describe("ScreenContextPreview", () => {
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
});
