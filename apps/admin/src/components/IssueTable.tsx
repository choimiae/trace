import type { Issue } from "@trace/shared";
import { Eye } from "lucide-react";
import { Button } from "../ui/Button.js";
import { Chip, issueStatusToChip } from "../ui/Chip.js";
import { Card } from "../ui/Card.js";
import { DataTable, type Column } from "../ui/DataTable.js";

export function IssueTable({
  issues,
  onSelectIssue,
}: {
  issues: Issue[];
  onSelectIssue?: ((issue: Issue) => void) | undefined;
}) {
  const columns: Array<Column<Issue>> = [
    {
      key: "title",
      header: "제목",
      render: (issue) => (
        <>
          <strong>{issue.title}</strong>
          <span className="cell-sub">{issue.summary}</span>
        </>
      ),
    },
    {
      key: "status",
      header: "상태",
      render: (issue) => {
        const chip = issueStatusToChip(issue.status);
        return <Chip status={chip.status} label={chip.label} />;
      },
    },
    { key: "path", header: "화면", render: (issue) => issue.relatedUrlPath ?? "-" },
    { key: "sessions", header: "세션", align: "end", render: (issue) => issue.affectedSessionsCount },
    { key: "score", header: "점수", align: "end", render: (issue) => issue.severityScore },
    {
      key: "action",
      header: "",
      headerLabel: "작업",
      align: "end",
      render: (issue) => (
        <Button variant="icon" aria-label={`${issue.title} 보기`} onClick={() => onSelectIssue?.(issue)}>
          <Eye aria-hidden="true" size={18} />
        </Button>
      ),
    },
  ];

  return (
    <Card as="section" className="table-panel">
      <div className="section-heading">
        <h2>문제 목록</h2>
        <span>{issues.length}건</span>
      </div>
      <DataTable
        columns={columns}
        rows={issues}
        rowKey={(issue) => issue.issueId}
        empty="아직 감지된 문제가 없습니다."
      />
    </Card>
  );
}
