import type { Issue, SessionTimelineEvent } from "@trace/shared";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { getSessionTimeline } from "../api.js";
import { SessionTimeline } from "../components/SessionTimeline.js";

export function IssueDetailPage({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const [timeline, setTimeline] = useState<SessionTimelineEvent[]>([]);
  const sessionId = issue.exampleSessionIds[0];

  useEffect(() => {
    if (!sessionId) {
      setTimeline([]);
      return;
    }

    getSessionTimeline(issue.projectId, sessionId).then(setTimeline);
  }, [issue.projectId, sessionId]);

  return (
    <aside className="detail-drawer" aria-label="문제 상세">
      <div className="detail-header">
        <div>
          <p className="eyebrow">문제 상세</p>
          <h2>{issue.title}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="닫기">
          <X aria-hidden="true" size={18} />
        </button>
      </div>
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
          <dd>{issue.status}</dd>
        </div>
      </dl>
      <p className="detail-summary">{issue.summary}</p>
      <SessionTimeline events={timeline} />
    </aside>
  );
}
