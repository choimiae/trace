import type { Issue, SessionTimelineEvent } from "@trace/shared";
import { X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useState } from "react";
import { getSessionTimeline } from "../api.js";
import { ScreenContextPreview } from "../components/ScreenContextPreview.js";
import { SessionTimeline } from "../components/SessionTimeline.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Chip, issueStatusToChip } from "../ui/Chip.js";

export function IssueDetailPage({
  issue,
  onClose,
  showPreviewLabels = false,
  onTogglePreviewLabels = () => {},
}: {
  issue: Issue;
  onClose: () => void;
  showPreviewLabels?: boolean;
  onTogglePreviewLabels?: (next: boolean) => void;
}) {
  const [timeline, setTimeline] = useState<SessionTimelineEvent[]>([]);
  const sessionId = issue.exampleSessionIds[0];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!sessionId) {
      setTimeline([]);
      return;
    }

    getSessionTimeline(issue.projectId, sessionId).then(setTimeline);
  }, [issue.projectId, sessionId]);

  // 배경 클릭으로 닫는다. stopPropagation 대신 target 비교를 쓰는 이유는,
  // 안쪽에서 시작한 클릭이 버블링으로 배경에 닿아도 배경 자신이 아니면
  // 닫지 않기 때문이다.
  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="detail-backdrop" onClick={handleBackdropClick}>
      <Card as="section" className="detail-dialog" role="dialog" aria-modal aria-label="문제 상세">
        <div className="detail-header">
          <div>
            <p className="eyebrow">문제 상세</p>
            <h2>{issue.title}</h2>
          </div>
          <Button variant="icon" aria-label="닫기" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </Button>
        </div>
        {issue.representativeEvent?.screenContext ? (
          <section className="issue-detail__screen-context" aria-label="대표 화면 맥락">
            <h3>대표 화면 맥락</h3>
            <ScreenContextPreview
              context={issue.representativeEvent.screenContext}
              event={issue.representativeEvent}
              showLabels={showPreviewLabels}
              onToggleLabels={onTogglePreviewLabels}
            />
          </section>
        ) : null}
        <dl className="detail-metrics">
          <div>
            <dt>심각도</dt>
            <dd>{issue.severityScore}</dd>
          </div>
          <div>
            <dt>영향 세션</dt>
            <dd>{issue.affectedSessionsCount}</dd>
          </div>
          <div>
            <dt>상태</dt>
            <dd>
              {(() => {
                const chip = issueStatusToChip(issue.status);
                return <Chip status={chip.status} label={chip.label} />;
              })()}
            </dd>
          </div>
        </dl>
        <p className="detail-summary">{issue.summary}</p>
        <SessionTimeline events={timeline} />
      </Card>
    </div>
  );
}
