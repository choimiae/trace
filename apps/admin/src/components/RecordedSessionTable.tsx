import type { RecordedSessionResponse } from "../api.js";
import { formatKoreanDateTime } from "../time.js";
import { Button } from "../ui/Button.js";
import { DataTable, type Column } from "../ui/DataTable.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function RecordedSessionTable({
  sessions,
  onSelectSession,
}: {
  sessions: RecordedSessionResponse[];
  onSelectSession: (sessionId: string) => void;
}) {
  const columns: Array<Column<RecordedSessionResponse>> = [
    { key: "sessionId", header: "세션", render: (row) => <code>{row.sessionId}</code> },
    {
      key: "startedAt",
      header: "시작 (KST)",
      render: (row) => formatKoreanDateTime(row.startedAt),
    },
    {
      key: "eventCount",
      header: "이벤트",
      align: "end",
      render: (row) => String(row.eventCount),
    },
    {
      key: "bytes",
      header: "크기",
      align: "end",
      // gzip 상태의 크기다. 재생할 때 브라우저가 푸는 양은 약 10배다.
      render: (row) => formatBytes(row.bytes),
    },
    {
      key: "actions",
      header: "",
      headerLabel: "재생",
      align: "end",
      render: (row) => <Button onClick={() => onSelectSession(row.sessionId)}>재생</Button>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={sessions}
      rowKey={(row) => row.sessionId}
      empty="기록된 세션이 없습니다. 리플레이는 트리거가 걸린 세션만 올라오고 기본 7일 뒤 지워집니다."
    />
  );
}
