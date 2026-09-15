import type { PageStatsResponse } from "../api.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { DataTable, type Column } from "../ui/DataTable.js";

function formatDwell(ms: number | undefined): string {
  // page_leave 가 한 번도 안 나간 페이지가 있다. 0초로 보이면 "머물지
  // 않았다" 로 읽혀 사실과 다르다.
  if (ms === undefined) return "-";

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function PageStatsPage({
  pages,
  onBack,
}: {
  pages: PageStatsResponse[];
  onBack: () => void;
}) {
  const columns: Array<Column<PageStatsResponse>> = [
    { key: "urlPath", header: "화면", render: (row) => <code>{row.urlPath}</code> },
    { key: "views", header: "방문", align: "end", render: (row) => String(row.views) },
    {
      key: "dwell",
      header: "평균 체류",
      align: "end",
      render: (row) => formatDwell(row.averageDwellMs),
    },
    { key: "exit", header: "이탈률", align: "end", render: (row) => percent(row.exitRate) },
    ...[25, 50, 75, 100].map((depth) => ({
      key: `reach-${depth}`,
      header: `${depth}%`,
      headerLabel: `스크롤 ${depth}% 도달`,
      align: "end" as const,
      render: (row: PageStatsResponse) =>
        percent(row.scrollReach.find((reach) => reach.depth === depth)?.ratio ?? 0),
    })),
  ];

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>페이지 통계</h1>
        </div>
        <div className="header-actions">
          <Button onClick={onBack}>대시보드로 돌아가기</Button>
        </div>
      </header>
      <Card as="section">
        <DataTable
          columns={columns}
          rows={pages}
          rowKey={(row) => row.urlPath}
          empty="아직 집계할 페이지 방문이 없습니다. 사이트에 스크립트를 붙이면 방문마다 쌓입니다."
        />
      </Card>
    </main>
  );
}
