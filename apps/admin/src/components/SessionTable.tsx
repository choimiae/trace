import type { SessionResponse } from "../api.js";
import { formatKoreanDateTime } from "../time.js";
import { Button } from "../ui/Button.js";
import { DataTable, type Column } from "../ui/DataTable.js";

function formatDuration(startedAt: string, lastSeenAt: string): string {
  const ms = Date.parse(lastSeenAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms <= 0) return "-";

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export function SessionTable({
  sessions,
  onSelectSession,
  onReplaySession,
}: {
  sessions: SessionResponse[];
  onSelectSession: (sessionId: string) => void;
  onReplaySession: (sessionId: string) => void;
}) {
  const columns: Array<Column<SessionResponse>> = [
    { key: "sessionId", header: "세션", render: (row) => <code>{row.sessionId}</code> },
    {
      key: "startedAt",
      header: "시작 (KST)",
      render: (row) => formatKoreanDateTime(row.startedAt),
    },
    {
      key: "duration",
      header: "지속",
      align: "end",
      render: (row) => formatDuration(row.startedAt, row.lastSeenAt),
    },
    {
      key: "eventCount",
      header: "이벤트",
      align: "end",
      render: (row) => String(row.eventCount),
    },
    {
      key: "actions",
      header: "",
      headerLabel: "보기",
      align: "end",
      render: (row) => (
        <span className="session-actions">
          {/* 리플레이를 켜기 전 세션이나 보존 기간이 지난 세션은 기록이 없다.
              누를 수 없는 버튼을 두지 않는다. */}
          {row.hasRecording ? (
            <Button onClick={() => onReplaySession(row.sessionId)}>재생</Button>
          ) : null}
          <Button onClick={() => onSelectSession(row.sessionId)}>타임라인</Button>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={sessions}
      rowKey={(row) => row.sessionId}
      empty="아직 수집된 세션이 없습니다. 사이트에 스크립트를 붙이면 방문마다 한 줄씩 쌓입니다."
    />
  );
}
