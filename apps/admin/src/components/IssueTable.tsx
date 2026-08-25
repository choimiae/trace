import type { Issue } from "@trace/shared";
import { Eye } from "lucide-react";

export function IssueTable({
  issues,
  onSelectIssue,
}: {
  issues: Issue[];
  onSelectIssue?: ((issue: Issue) => void) | undefined;
}) {
  return (
    <section className="table-panel">
      <div className="section-heading">
        <h2>문제 목록</h2>
        <span>{issues.length}건</span>
      </div>
      {issues.length === 0 ? (
        <p className="empty-state">아직 감지된 문제가 없습니다.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>제목</th>
              <th>유형</th>
              <th>화면</th>
              <th>세션</th>
              <th>점수</th>
              <th aria-label="작업" />
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.issueId}>
                <td>
                  <strong>{issue.title}</strong>
                  <span>{issue.summary}</span>
                </td>
                <td>{issue.issueType}</td>
                <td>{issue.relatedUrlPath ?? "-"}</td>
                <td>{issue.affectedSessionsCount}</td>
                <td>{issue.severityScore}</td>
                <td>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => onSelectIssue?.(issue)}
                    aria-label={`${issue.title} 보기`}
                  >
                    <Eye aria-hidden="true" size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
