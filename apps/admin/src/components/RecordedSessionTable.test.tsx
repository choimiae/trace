import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordedSessionTable } from "./RecordedSessionTable.js";

expect.extend(matchers);
afterEach(cleanup);

const sessions = [
  {
    sessionId: "sess_abc",
    startedAt: "2026-09-15T00:00:00.000Z",
    lastReceivedAt: "2026-09-15T00:05:00.000Z",
    chunkCount: 2,
    eventCount: 120,
    bytes: 58_026,
  },
];

describe("RecordedSessionTable", () => {
  it("세션 한 줄을 그린다", () => {
    render(<RecordedSessionTable sessions={sessions} onSelectSession={() => undefined} />);

    expect(screen.getByText("sess_abc")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    // gzip 크기를 사람이 읽는 단위로 보여준다.
    expect(screen.getByText("56.7 KB")).toBeInTheDocument();
  });

  it("행의 버튼을 누르면 sessionId 를 넘긴다", () => {
    const onSelectSession = vi.fn();
    render(<RecordedSessionTable sessions={sessions} onSelectSession={onSelectSession} />);

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(onSelectSession).toHaveBeenCalledWith("sess_abc");
  });

  it("비어 있으면 왜 비었는지 알려준다", () => {
    render(<RecordedSessionTable sessions={[]} onSelectSession={() => undefined} />);

    expect(
      screen.getByText(/트리거가 걸린 세션만 올라오고 기본 7일 뒤 지워집니다/),
    ).toBeInTheDocument();
  });
});
