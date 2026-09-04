import { type DashboardSummary, type Issue, issueTypeLabel } from "@trace/shared";
import { ArrowDown, ArrowRight, ArrowUp, Eye } from "lucide-react";
import type { ReactNode } from "react";
import { formatKoreanDateTime } from "../time.js";
import { Chip, issueStatusToChip } from "../ui/Chip.js";
import { Card } from "../ui/Card.js";
import { ScreenContextPreview } from "./ScreenContextPreview.js";

type SeverityLevel = "critical" | "warning" | "low";

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  critical: "긴급",
  warning: "주의",
  low: "낮음",
};

function severityLevel(score: number): SeverityLevel {
  if (score >= 80) return "critical";
  if (score >= 50) return "warning";
  return "low";
}

function sortByPriority(issues: Issue[]): Issue[] {
  return [...issues].sort((left, right) => {
    if (right.severityScore !== left.severityScore) {
      return right.severityScore - left.severityScore;
    }
    return new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
  });
}

function sortByRecent(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime(),
  );
}

function trendLabel(trend: Issue["trend"]): string {
  if (trend === "up") return "증가";
  if (trend === "down") return "감소";
  return "유지";
}

function trendIcon(trend: Issue["trend"]) {
  if (trend === "up") return ArrowUp;
  if (trend === "down") return ArrowDown;
  return ArrowRight;
}

export function IssueDashboardOverview({
  summary,
  issues,
  onSelectIssue,
}: {
  summary: DashboardSummary;
  issues: Issue[];
  onSelectIssue?: ((issue: Issue) => void) | undefined;
}) {
  if (issues.length === 0) return null;

  const priorityIssues = sortByPriority(issues);
  const recentIssues = sortByRecent(issues).slice(0, 5);
  const topIssue = priorityIssues[0]!;
  const representativeEvent = topIssue.representativeEvent;
  const titleMasked = representativeEvent?.screenContext?.titleMasked;
  const heroTitle =
    topIssue.relatedUrlPath && titleMasked
      // 함수 형태로 넘긴다. 화면 이름에 $&·$`·$'·$$ 가 있으면 문자열 치환값이
      // 패턴으로 해석돼 지우려던 경로가 다시 들어온다.
      ? topIssue.title.replace(topIssue.relatedUrlPath, () => titleMasked)
      : topIssue.title;
  const topIssueSeverity = severityLevel(topIssue.severityScore);
  const topIssueStatus = issueStatusToChip(topIssue.status);
  const TopIssueTrendIcon = trendIcon(topIssue.trend);
  const severityCounts = issues.reduce<Record<SeverityLevel, number>>(
    (counts, issue) => {
      counts[severityLevel(issue.severityScore)] += 1;
      return counts;
    },
    { critical: 0, warning: 0, low: 0 },
  );
  const heroTarget = representativeEvent?.screenContext?.target;
  const clickEvidence = heroTarget
    ? `${heroTarget.tagName}${heroTarget.textMaskedOrLimited ? ` · "${heroTarget.textMaskedOrLimited}"` : ""}`
    : "-";
  const risingCount = issues.filter((issue) => issue.trend === "up").length;
  const maxTargetCount = Math.max(...summary.topTargets.map((target) => target.count), 1);
  const maxIssueTypeCount = Math.max(...summary.issueTypeDistribution.map((item) => item.count), 1);

  return (
    <>
      <section className="friction-hero" aria-labelledby="friction-hero-eyebrow">
        {/* 읽는 순서: 1 문장 → 2 미리보기 → 3 근거 표 → 4 다음 액션 */}
        <div className="friction-hero__intro">
          <p className="friction-hero__eyebrow" id="friction-hero-eyebrow">
            가장 먼저 볼 사용자 막힘
          </p>
          <div className="friction-hero__headline">
            <h2>{heroTitle}</h2>
            <span className={`friction-hero__score friction-hero__score-${topIssueSeverity}`}>
              <strong>{topIssue.severityScore}</strong>
              <span>{SEVERITY_LABELS[topIssueSeverity]}</span>
            </span>
          </div>
        </div>
        <div className="friction-hero__screen">
          <ScreenContextPreview
            {...(representativeEvent?.screenContext ? { context: representativeEvent.screenContext } : {})}
            {...(representativeEvent ? { event: representativeEvent } : {})}
          />
          {representativeEvent ? (
            <p className="friction-hero__caption">
              {formatKoreanDateTime(representativeEvent.timestamp)} · {topIssue.summary}
            </p>
          ) : null}
        </div>
        <div className="friction-hero__analysis">
          <dl className="friction-hero__facts">
            <div>
              <dt>화면</dt>
              <dd>{topIssue.relatedUrlPath ?? "-"}</dd>
            </div>
            <div>
              {/*
                대표 이벤트는 이슈가 아니라 세션으로 고른다(findRepresentativeEvent 는
                프로젝트·세션·경로·시간창·타입만 본다). 그래서 여기 뜨는 클릭이 이
                이슈의 클릭이라는 보장이 없고, error_friction 은 오류 이벤트에
                screenContext 가 없어 언제나 다른 클릭이다. 라벨은 데이터가 뒷받침하는
                "같은 화면에서 일어난 클릭"까지만 말한다.
              */}
              <dt>화면 내 클릭</dt>
              <dd>{clickEvidence}</dd>
            </div>
            <div>
              <dt>패턴</dt>
              <dd>{issueTypeLabel(topIssue.issueType)}</dd>
            </div>
            {topIssue.relatedErrorSignature ? (
              <div>
                <dt>오류</dt>
                <dd>{topIssue.relatedErrorSignature}</dd>
              </div>
            ) : null}
            <div>
              <dt>영향</dt>
              <dd>
                {topIssue.affectedSessionsCount}세션 · 사용자 {topIssue.affectedUsersCount}명 · 최근{" "}
                {formatKoreanDateTime(topIssue.lastSeenAt)}
              </dd>
            </div>
          </dl>
          <dl className="friction-hero__action">
            <dt>다음 액션</dt>
            <dd>해당 화면의 클릭 후 반응, 성공 피드백, 오류 노출 상태를 우선 점검합니다.</dd>
          </dl>
        </div>
      </section>
      <Card as="section" className="dashboard-overview" aria-label="문제 한눈에 보기">
        <div className="section-heading">
          <h2>한눈에 보기</h2>
          <span>최근 발견 시각은 KST</span>
        </div>

        <div className="dashboard-overview-top">
          <button
            type="button"
            className={`priority-issue priority-issue-${topIssueSeverity}`}
            aria-label={`${topIssue.title} 보기`}
            onClick={() => onSelectIssue?.(topIssue)}
          >
            <span className="priority-issue-score">
              <strong>{topIssue.severityScore}</strong>
              <span>{SEVERITY_LABELS[topIssueSeverity]}</span>
            </span>
            <span className="priority-issue-meta">
              <Chip status={topIssueStatus.status} label={topIssueStatus.label} />
              <span className={`issue-trend issue-trend-${topIssue.trend}`}>
                <TopIssueTrendIcon aria-hidden="true" size={14} />
                {trendLabel(topIssue.trend)}
              </span>
              <span>세션 {topIssue.affectedSessionsCount}</span>
              <span>사용자 {topIssue.affectedUsersCount}</span>
              <span>최근 발견 {formatKoreanDateTime(topIssue.lastSeenAt)}</span>
            </span>
            <Eye className="priority-issue-open" aria-hidden="true" size={18} />
          </button>

          <div className="overview-card">
            <h3>심각도 분포</h3>
            {(["critical", "warning", "low"] as const).map((level) => (
              <div className="overview-meter" key={level}>
                <span>{SEVERITY_LABELS[level]}</span>
                <strong>{severityCounts[level]}건</strong>
                <i
                  className={`overview-meter-bar overview-meter-${level}`}
                  style={{ width: `${Math.max(8, (severityCounts[level] / issues.length) * 100)}%` }}
                />
              </div>
            ))}
          </div>

          <div className="overview-card overview-mini-grid">
            <h3>최근 흐름</h3>
            <div>
              <strong>{summary.newIssuesCount}</strong>
              <span>신규</span>
            </div>
            <div>
              <strong>{risingCount}</strong>
              <span>상승</span>
            </div>
            <div>
              <strong>{summary.affectedSessionsCount}</strong>
              <span>영향 세션</span>
            </div>
            <div>
              <strong>{summary.totalEventsCount}</strong>
              <span>이벤트</span>
            </div>
          </div>
        </div>

        <div className="dashboard-overview-panels">
          <OverviewListPanel title="문제가 많은 화면">
            {summary.topTargets.slice(0, 5).map((target) => (
              <OverviewBar
                key={target.label}
                label={target.label}
                value={`${target.count}건`}
                percent={(target.count / maxTargetCount) * 100}
              />
            ))}
          </OverviewListPanel>

          <OverviewListPanel title="문제 원인">
            {summary.issueTypeDistribution.slice(0, 5).map((item) => (
              <OverviewBar
                key={item.issueType}
                label={issueTypeLabel(item.issueType)}
                value={`${item.count}건`}
                percent={(item.count / maxIssueTypeCount) * 100}
              />
            ))}
          </OverviewListPanel>

          <OverviewListPanel title="최근 발견">
            {recentIssues.map((issue) => (
              <button
                type="button"
                className="recent-issue-row"
                key={issue.issueId}
                onClick={() => onSelectIssue?.(issue)}
              >
                <span>{issue.title}</span>
                <strong>{formatKoreanDateTime(issue.lastSeenAt)}</strong>
              </button>
            ))}
          </OverviewListPanel>
        </div>
      </Card>
    </>
  );
}

function OverviewListPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overview-card overview-list-panel">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function OverviewBar({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div className="overview-bar-row">
      <span>
        <strong>{label}</strong>
        <em>{value}</em>
      </span>
      <i style={{ width: `${Math.max(8, percent)}%` }} />
    </div>
  );
}
