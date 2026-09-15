import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDetailDialog } from "./SessionDetailDialog.js";

expect.extend(matchers);
afterEach(cleanup);

vi.mock("../api.js", () => ({
  getSessionTimeline: vi.fn().mockResolvedValue([]),
}));

function renderDialog(overrides = {}) {
  return render(
    <SessionDetailDialog
      projectId="proj_demo"
      sessionId="sess_1"
      hasRecording={false}
      onClose={() => undefined}
      onReplay={() => undefined}
      {...overrides}
    />,
  );
}

describe("SessionDetailDialog", () => {
  it("다이얼로그로 열리고 세션 타임라인을 보여준다", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "세션 상세" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(await screen.findByText("세션 타임라인")).toBeInTheDocument();
    expect(screen.getByText("sess_1")).toBeInTheDocument();
  });

  it("가려진 배경을 누르면 닫는다", () => {
    const onClose = vi.fn();
    const { container } = renderDialog({ onClose });

    fireEvent.click(container.querySelector(".detail-backdrop") as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape 로 닫는다", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 기록이 없는 세션이 대부분이다. 없는데 버튼을 두면 눌러도 아무 일이 없다.
  it("기록이 없으면 재생 버튼을 두지 않는다", () => {
    renderDialog({ hasRecording: false });

    expect(screen.queryByRole("button", { name: "재생" })).not.toBeInTheDocument();
  });

  it("기록이 있으면 재생 버튼으로 넘긴다", () => {
    const onReplay = vi.fn();
    renderDialog({ hasRecording: true, onReplay });

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(onReplay).toHaveBeenCalledTimes(1);
  });
});
