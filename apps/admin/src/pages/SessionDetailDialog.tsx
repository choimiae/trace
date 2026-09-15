import type { SessionTimelineEvent } from "@trace/shared";
import { X } from "lucide-react";
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getSessionTimeline } from "../api.js";
import { SessionTimeline } from "../components/SessionTimeline.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

export function SessionDetailDialog({
  projectId,
  sessionId,
  hasRecording,
  onClose,
  onReplay,
}: {
  projectId: string;
  sessionId: string;
  hasRecording: boolean;
  onClose: () => void;
  onReplay: () => void;
}) {
  const [timeline, setTimeline] = useState<SessionTimelineEvent[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    getSessionTimeline(projectId, sessionId).then((events) => {
      if (active) setTimeline(events);
    });
    return () => {
      active = false;
    };
  }, [projectId, sessionId]);

  // 문제 상세와 같은 방식이다. target 비교를 쓰면 안쪽에서 시작한 클릭이
  // 버블링으로 배경에 닿아도 닫지 않는다.
  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="detail-backdrop" onClick={handleBackdropClick}>
      <Card as="section" className="detail-dialog" role="dialog" aria-modal aria-label="세션 상세">
        <div className="detail-header">
          <div>
            <p className="eyebrow">세션 상세</p>
            <h2>
              <code>{sessionId}</code>
            </h2>
          </div>
          <div className="header-actions">
            {/* 기록은 트리거가 걸린 세션만 올라온다. 없으면 버튼도 없다. */}
            {hasRecording ? <Button onClick={onReplay}>재생</Button> : null}
            <Button variant="icon" aria-label="닫기" onClick={onClose}>
              <X aria-hidden="true" size={18} />
            </Button>
          </div>
        </div>
        <SessionTimeline events={timeline} />
      </Card>
    </div>
  );
}
