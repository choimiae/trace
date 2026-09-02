import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionTimeline } from "./SessionTimeline.js";

expect.extend(matchers);
afterEach(cleanup);

describe("SessionTimeline", () => {
  it("이벤트 발생 시각을 한국시간으로 보여준다", () => {
    render(
      <SessionTimeline
        events={[{
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-01T06:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          metadata: {},
        }]}
      />,
    );

    expect(screen.getByText("2026-09-01 15:00:00")).toBeInTheDocument();
  });

  it("renders screen context evidence inside the timeline", () => {
    render(
      <SessionTimeline
        events={[
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
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
        ]}
      />,
    );

    expect(screen.getByText("저장")).toBeInTheDocument();
    expect(screen.getByLabelText("화면 맥락 미리보기")).toBeInTheDocument();
  });
});
