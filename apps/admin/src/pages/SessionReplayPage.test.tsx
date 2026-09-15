import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    addEvent(event: unknown) {
      this.events.push(event);
    },
    play() {
      this.played += 1;
    },
    pause() {},
    setSpeed() {},
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
      await screen.findByText(/트리거가 걸린 세션만 올라오고 기본 7일 뒤 지워집니다/),
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
