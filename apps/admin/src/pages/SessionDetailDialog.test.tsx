import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDetailDialog } from "./SessionDetailDialog.js";

expect.extend(matchers);

// 자동 목(vi.mock("../api.js") 한 줄)을 쓰지 않는다. 그러면 ApiError 의
// 생성자 본문이 돌지 않아 error.status 가 undefined 가 되고 401/403 분기를
// 아무 테스트도 밟지 못한다. SessionReplayPage.test.tsx 와 같은 방식으로
// ApiError 는 진짜 클래스로 두고 함수만 가짜로 바꾼다.
const api = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
  getSessionTimeline: vi.fn(),
}));

vi.mock("../api.js", () => api);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(overrides = {}) {
  return render(
    <SessionDetailDialog
      projectId="proj_demo"
      sessionId="sess_1"
      hasRecording={false}
      onClose={() => undefined}
      onReplay={() => undefined}
      onAuthExpired={() => undefined}
      {...overrides}
    />,
  );
}

describe("SessionDetailDialog", () => {
  it("다이얼로그로 열리고 조회한 세션 타임라인 이벤트를 보여준다", async () => {
    // 한 건짜리 픽스처를 쓴다. mockResolvedValue([]) 는 SessionTimeline 의
    // 정적 <h2>("세션 타임라인") 만으로 통과해 fetch effect 를 통째로 지워도
    // 안 걸리는 테스트가 된다(F6) - 실제로 받아온 이벤트가 화면에 그려지는지
    // 확인해야 그 effect 가 살아있다는 증거가 된다.
    api.getSessionTimeline.mockResolvedValue([
      {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-15T00:00:00.000Z",
        type: "click",
        urlPath: "/settings",
        metadata: {},
      },
    ]);

    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "세션 상세" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("sess_1")).toBeInTheDocument();
    expect(await screen.findByText("click")).toBeInTheDocument();
    expect(screen.getByText("/settings")).toBeInTheDocument();
  });

  it("가려진 배경을 누르면 닫는다", () => {
    api.getSessionTimeline.mockResolvedValue([]);
    const onClose = vi.fn();
    const { container } = renderDialog({ onClose });

    fireEvent.click(container.querySelector(".detail-backdrop") as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape 로 닫는다", () => {
    api.getSessionTimeline.mockResolvedValue([]);
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 리플레이를 켜기 전이거나 보존 기간이 지난 세션은 기록이 없다. 없는데 버튼을 두면 눌러도 아무 일이 없다.
  it("기록이 없으면 재생 버튼을 두지 않는다", () => {
    api.getSessionTimeline.mockResolvedValue([]);
    renderDialog({ hasRecording: false });

    expect(screen.queryByRole("button", { name: "재생" })).not.toBeInTheDocument();
  });

  it("기록이 있으면 재생 버튼으로 넘긴다", () => {
    api.getSessionTimeline.mockResolvedValue([]);
    const onReplay = vi.fn();
    renderDialog({ hasRecording: true, onReplay });

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  // F2: getSessionTimeline 이 reject 됐을 때 timeline 을 [] 로 둔 채 조용히
  // 삼키면 SessionTimeline 의 빈 상태 문구("표시할 세션 이벤트가 없습니다.")
  // 가 떠 실패를 빈 세션으로 오인하게 한다. 실패는 다른 문구로 보여야 한다.
  it("401 이면 세션이 끝난 것을 알린다", async () => {
    api.getSessionTimeline.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));
    const onAuthExpired = vi.fn();

    renderDialog({ onAuthExpired });

    await waitFor(() => expect(onAuthExpired).toHaveBeenCalledTimes(1));
  });

  it("403 이면 접근할 수 없다고 말하고 빈 상태 문구를 보여주지 않는다", async () => {
    api.getSessionTimeline.mockRejectedValue(new api.ApiError(403, "project_access_denied"));

    renderDialog();

    expect(await screen.findByText("이 프로젝트에 접근할 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("표시할 세션 이벤트가 없습니다.")).not.toBeInTheDocument();
  });

  it("그 밖의 실패면 못 불러왔다고 말하고 빈 상태 문구를 보여주지 않는다", async () => {
    api.getSessionTimeline.mockRejectedValue(new Error("network down"));

    renderDialog();

    expect(
      await screen.findByText("세션 타임라인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByText("표시할 세션 이벤트가 없습니다.")).not.toBeInTheDocument();
  });
});
