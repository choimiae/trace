import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReplayPage } from "./SessionReplayPage.js";

expect.extend(matchers);

// 자동 목(vi.mock("../api.js") 한 줄)을 쓰지 않는다. 그러면 ApiError 의
// 생성자 본문이 돌지 않아 error.status 가 undefined 가 되고 401/403 분기를
// 아무 테스트도 밟지 못한다. App.test.tsx 와 같은 방식으로 ApiError 는 진짜
// 클래스로 두고 함수만 가짜로 바꾼다.
const api = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
  getRecordingManifest: vi.fn(),
  getRecordingChunk: vi.fn(),
}));

vi.mock("../api.js", () => api);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fakePlayer() {
  return {
    events: [] as unknown[],
    played: 0,
    speeds: [] as number[],
    fitCalls: 0,
    addEvent(event: unknown) {
      this.events.push(event);
    },
    play() {
      this.played += 1;
    },
    pause() {},
    setSpeed(speed: number) {
      this.speeds.push(speed);
    },
    fit() {
      this.fitCalls += 1;
    },
    destroy() {},
  };
}

const manifest = [
  { seq: 0, eventCount: 1, bytes: 10, startedAt: "2026-09-15T00:00:00.000Z", receivedAt: "2026-09-15T00:00:01.000Z" },
  { seq: 1, eventCount: 1, bytes: 10, startedAt: "2026-09-15T00:00:00.000Z", receivedAt: "2026-09-15T00:00:02.000Z" },
];

describe("SessionReplayPage", () => {
  beforeEach(() => {
    api.getRecordingManifest.mockResolvedValue(manifest);
    api.getRecordingChunk.mockImplementation(async (_p: string, _s: string, seq: number) => ({
      events: [{ type: 2, seq }],
    }));
  });

  it("첫 청크가 도착하면 재생을 시작하고 나머지를 뒤에서 채운다", async () => {
    const player = fakePlayer();

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => player}
      />,
    );

    await waitFor(() => expect(player.played).toBe(1));
    await waitFor(() => expect(player.events).toEqual([{ type: 2, seq: 1 }]));
  });

  it("기록이 없으면 왜 없는지 알려준다", async () => {
    api.getRecordingManifest.mockResolvedValue([]);

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_none"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(
      await screen.findByText("이 세션은 녹화가 없습니다. 리플레이를 켜기 전이거나 보존 기간이 지났습니다."),
    ).toBeInTheDocument();
  });

  it("청크 하나가 깨져도 거기까지 재생하고 알려준다", async () => {
    api.getRecordingChunk.mockImplementation(async (_p: string, _s: string, seq: number) =>
      seq === 0 ? { events: [{ type: 2 }] } : { events: "깨짐" },
    );
    const player = fakePlayer();

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => player}
      />,
    );

    expect(await screen.findByText("이후 기록을 읽지 못했습니다.")).toBeInTheDocument();
    expect(player.played).toBe(1);
  });

  // 최종 리뷰 지적: 매니페스트가 청크를 줬는데 재생을 시작하기 전에 실패하면
  // (500 이든 seq 0 이 깨졌든) 화면이 "empty" 로 떨어져 보존 문구("보존 기간이
  // 지났습니다")를 보여줬다 - 운영자가 DB 에 있는 기록을 없는 것으로
  // 오해한다. manifest.length === 0 일 때만 "empty" 를 쓰고, 나머지 실패는
  // 새 상태(읽지 못함)로 갈라야 한다.
  it("매니페스트는 청크를 줬는데 첫 청크 요청이 실패하면 읽지 못했다고 알린다 (기록 없음이 아니다)", async () => {
    api.getRecordingChunk.mockRejectedValue(new Error("network down"));

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(await screen.findByText(/기록을 읽지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/보존 기간이 지났습니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/이 세션은 녹화가 없습니다/)).not.toBeInTheDocument();
  });

  it("매니페스트는 청크를 줬는데 첫 청크가 깨져 있으면 읽지 못했다고 알린다 (기록 없음이 아니다)", async () => {
    api.getRecordingChunk.mockResolvedValue({ events: "깨짐" });

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(await screen.findByText(/기록을 읽지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/보존 기간이 지났습니다/)).not.toBeInTheDocument();
  });

  // 최종 리뷰 지적: forbidden·empty 에서도 재생/일시정지/배속 버튼이 살아
  // 있었다 - 접근 불가를 통보받은 운영자가 재생을 눌러도 아무 일도 안
  // 일어난다(재생기가 없으므로). 재생기가 있거나 있었던 상태(playing·
  // truncated)에서만 컨트롤을 그린다.
  it("접근할 수 없으면 재생 컨트롤을 그리지 않는다", async () => {
    api.getRecordingManifest.mockRejectedValue(new api.ApiError(403, "project_access_denied"));

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(await screen.findByText("이 프로젝트에 접근할 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "재생" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "일시정지" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2x" })).not.toBeInTheDocument();
  });

  it("기록이 없으면 재생 컨트롤을 그리지 않는다", async () => {
    api.getRecordingManifest.mockResolvedValue([]);

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_none"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(await screen.findByText(/리플레이를 켜기 전이거나 보존 기간이 지났습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "재생" })).not.toBeInTheDocument();
  });

  it("재생 중에는 컨트롤을 그린다", async () => {
    const player = fakePlayer();

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => player}
      />,
    );

    await waitFor(() => expect(player.played).toBe(1));
    expect(screen.getByRole("button", { name: "재생" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일시정지" })).toBeInTheDocument();
  });

  it("401 이면 세션이 끝난 것을 알린다", async () => {
    api.getRecordingManifest.mockRejectedValue(new api.ApiError(401, "admin_auth_required"));
    const onAuthExpired = vi.fn();

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={onAuthExpired}
        createPlayer={() => fakePlayer()}
      />,
    );

    await waitFor(() => expect(onAuthExpired).toHaveBeenCalledTimes(1));
  });

  it("403 이면 접근할 수 없다고 말한다", async () => {
    api.getRecordingManifest.mockRejectedValue(new api.ApiError(403, "project_access_denied"));

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(await screen.findByText("이 프로젝트에 접근할 수 없습니다.")).toBeInTheDocument();
  });

  // 이전에는 이 테스트가 매니페스트 로딩 중(재생기가 없을 때) "2x" 를 눌러
  // speedRef 지연 적용 경로를 확인했다. 최종 리뷰 Fix 3 가 .replay-controls
  // 를 playing||truncated 로 게이트하면서 로딩 중에는 버튼 자체가 없다 - 그
  // 시나리오를 UI 로는 더 이상 재현할 수 없다(플레이어가 만들어지는 순간과
  // state 가 "playing" 으로 바뀌는 순간이 같은 동기 블록이라, 버튼이 보일
  // 때는 이미 재생기가 있고 이미 배속이 적용된 뒤다). 대신 재생 중 배속
  // 버튼이 실제 재생기에 그대로 전달되는지를 검증한다.
  it("배속 버튼을 누르면 재생 중인 재생기에 그대로 적용된다", async () => {
    const player = fakePlayer();

    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => player}
      />,
    );

    await waitFor(() => expect(player.played).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "2x" }));
    // [1, 2] - 1 은 재생기 생성 시 기본 배속(speedRef 초기값)이 적용된 것이고,
    // 2 는 방금 누른 버튼이 반영된 것이다.
    expect(player.speeds).toEqual([1, 2]);
  });

  it("창 크기가 바뀌면 재생기에 다시 맞추라고 알린다", async () => {
    const player = fakePlayer();

    const { unmount } = render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => player}
      />,
    );

    await waitFor(() => expect(player.played).toBe(1));

    window.dispatchEvent(new Event("resize"));
    expect(player.fitCalls).toBe(1);

    unmount();
    window.dispatchEvent(new Event("resize"));
    expect(player.fitCalls).toBe(1);
  });

  it("원본 스타일시트를 불러온다는 것을 적는다", async () => {
    render(
      <SessionReplayPage
        projectId="proj_a"
        sessionId="sess_abc"
        onBack={() => undefined}
        onAuthExpired={() => undefined}
        createPlayer={() => fakePlayer()}
      />,
    );

    expect(await screen.findByText(/원본 사이트의 스타일시트를 불러옵니다/)).toBeInTheDocument();
  });
});
