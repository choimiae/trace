import { type Issue, issueTypeLabel } from "@trace/shared";
import { Eye, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { formatKoreanDateTime } from "../time.js";
import { Chip, issueStatusToChip } from "../ui/Chip.js";
import { Card } from "../ui/Card.js";

type SeverityLevel = "critical" | "warning" | "low";

const SEVERITY_META: Record<SeverityLevel, { label: string; tone: string }> = {
  critical: { label: "긴급", tone: "crit" },
  warning: { label: "주의", tone: "warn" },
  low: { label: "낮음", tone: "low" },
};

function severityLevel(score: number): SeverityLevel {
  if (score >= 80) return "critical";
  if (score >= 50) return "warning";
  return "low";
}

function trendLabel(trend: Issue["trend"]): string {
  if (trend === "up") return "증가";
  if (trend === "down") return "감소";
  return "유지";
}

function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((left, right) => {
    if (right.severityScore !== left.severityScore) {
      return right.severityScore - left.severityScore;
    }
    return new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
  });
}

export function IssueTable({
  issues,
  onSelectIssue,
}: {
  issues: Issue[];
  onSelectIssue?: ((issue: Issue) => void) | undefined;
}) {
  const sortedIssues = sortIssues(issues);
  const severityCounts = issues.reduce<Record<SeverityLevel, number>>(
    (counts, issue) => {
      counts[severityLevel(issue.severityScore)] += 1;
      return counts;
    },
    { critical: 0, warning: 0, low: 0 },
  );

  return (
    <Card as="section" className="table-panel">
      <div className="section-heading">
        <h2>문제 목록</h2>
        <span>{issues.length}건</span>
      </div>
      {issues.length === 0 ? (
        <p className="empty-state">아직 감지된 문제가 없습니다.</p>
      ) : (
        <>
          <div className="issue-overview-summary" aria-label="문제 심각도 요약">
            {(["critical", "warning", "low"] as const).map((level) => (
              <span className={`issue-summary-pill issue-summary-${level}`} key={level}>
                {SEVERITY_META[level].label} {severityCounts[level]}
              </span>
            ))}
          </div>
          <div className="issue-overview-list">
            {sortedIssues.map((issue) => {
              const severity = severityLevel(issue.severityScore);
              const severityMeta = SEVERITY_META[severity];
              const chip = issueStatusToChip(issue.status);
              const TrendIcon =
                issue.trend === "up" ? TrendingUp : issue.trend === "down" ? TrendingDown : Minus;

              return (
                <button
                  type="button"
                  aria-label={`${issue.title} 보기`}
                  className={`issue-overview-row issue-overview-${severity}`}
                  key={issue.issueId}
                  onClick={() => onSelectIssue?.(issue)}
                >
                  <span className={`issue-severity issue-severity-${severityMeta.tone}`}>
                    <strong>{issue.severityScore}</strong>
                    <span>{severityMeta.label}</span>
                  </span>
                  <span className="issue-main">
                    <span className="issue-kicker">{issueTypeLabel(issue.issueType)}</span>
                    <strong>{issue.title}</strong>
                    <span className="issue-summary">{issue.summary}</span>
                    <span className="issue-path">{issue.relatedUrlPath ?? "-"}</span>
                  </span>
                  <span className="issue-meta">
                    <span className="issue-meta-top">
                      <Chip status={chip.status} label={chip.label} />
                      <span className={`issue-trend issue-trend-${issue.trend}`}>
                        <TrendIcon aria-hidden="true" size={14} />
                        {trendLabel(issue.trend)}
                      </span>
                    </span>
                    <span className="issue-stats">
                      <span>세션 {issue.affectedSessionsCount}</span>
                      <span>사용자 {issue.affectedUsersCount}</span>
                    </span>
                    <span className="issue-last-seen">
                      마지막 발견 {formatKoreanDateTime(issue.lastSeenAt)}
                    </span>
                  </span>
                  <span className="issue-open-icon" aria-hidden="true">
                    <Eye size={18} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
