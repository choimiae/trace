import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTable } from "./SessionTable.js";

expect.extend(matchers);
afterEach(cleanup);

const sessions = [
  {
    sessionId: "sess_recorded",
    startedAt: "2026-09-15T00:00:00.000Z",
    lastSeenAt: "2026-09-15T00:05:00.000Z",
    eventCount: 120,
    hasRecording: true,
  },
  {
    sessionId: "sess_plain",
    startedAt: "2026-09-14T00:00:00.000Z",
    lastSeenAt: "2026-09-14T00:00:30.000Z",
    eventCount: 4,
    hasRecording: false,
  },
];

function renderTable(overrides: Partial<React.ComponentProps<typeof SessionTable>> = {}) {
  return render(
    <SessionTable
      sessions={sessions}
      onSelectSession={() => undefined}
      onReplaySession={() => undefined}
      {...overrides}
    />,
  );
}

describe("SessionTable", () => {
  it("세션을 한 줄씩 그린다", () => {
    renderTable();

    expect(screen.getByText("sess_recorded")).toBeInTheDocument();
    expect(screen.getByText("sess_plain")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  // 기록은 트리거가 걸린 세션만 올라온다. 대부분의 행에는 재생이 없다.
  it("기록이 있는 세션에만 재생을 붙인다", () => {
    renderTable();

    expect(screen.getAllByRole("button", { name: "재생" })).toHaveLength(1);
  });

  it("타임라인은 모든 행에 있다", () => {
    renderTable();

    expect(screen.getAllByRole("button", { name: "타임라인" })).toHaveLength(2);
  });

  it("타임라인을 누르면 그 행의 sessionId 를 넘긴다", () => {
    const onSelectSession = vi.fn();
    renderTable({ onSelectSession });

    const row = screen.getByText("sess_plain").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "타임라인" }));

    expect(onSelectSession).toHaveBeenCalledWith("sess_plain");
  });

  it("재생을 누르면 그 행의 sessionId 를 넘긴다", () => {
    const onReplaySession = vi.fn();
    renderTable({ onReplaySession });

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(onReplaySession).toHaveBeenCalledWith("sess_recorded");
  });

  it("지속 시간을 보여준다", () => {
    renderTable();

    expect(screen.getByText("5분 0초")).toBeInTheDocument();
    expect(screen.getByText("30초")).toBeInTheDocument();
  });

  it("비어 있으면 왜 비었는지 알려준다", () => {
    renderTable({ sessions: [] });

    expect(screen.getByText(/아직 수집된 세션이 없습니다/)).toBeInTheDocument();
  });
});
