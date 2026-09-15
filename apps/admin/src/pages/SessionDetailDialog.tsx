import type { SessionTimelineEvent } from "@trace/shared";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ApiError, getSessionTimeline } from "../api.js";
import { SessionTimeline } from "../components/SessionTimeline.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

// "loading" 은 다이얼로그가 방금 열려 아직 응답을 못 받은 상태다. 응답이
// 빈 배열이면 "loaded" 로 두고 빈 상태 문구는 SessionTimeline 이 보여준다 -
// 실패를 여기 섞으면 "이 세션은 비어 있다" 와 "지금 못 불러왔다" 가 구분되지
// 않는다(F2). 401 은 화면 상태로 두지 않는다 - onAuthExpired 로 곧장 로그인
// 화면으로 돌린다. SessionReplayPage 와 같은 모양이다.
type TimelineState = "loading" | "loaded" | "forbidden" | "error";

export function SessionDetailDialog({
  projectId,
  sessionId,
  hasRecording,
  onClose,
  onReplay,
  onAuthExpired,
}: {
  projectId: string;
  sessionId: string;
  hasRecording: boolean;
  onClose: () => void;
  onReplay: () => void;
  /** 401 일 때 App 이 로그인 화면으로 돌린다. 화면이 스스로 라우팅하지 않는다. */
  onAuthExpired: () => void;
}) {
  const [timeline, setTimeline] = useState<SessionTimelineEvent[]>([]);
  const [timelineState, setTimelineState] = useState<TimelineState>("loading");
  // SessionReplayPage 와 같은 이유로 ref 에 담는다 - 호출자가 인라인 화살표를
  // 넘기면 매 렌더마다 identity 가 바뀌어 effect 의존성에 넣을 수 없다.
  const onAuthExpiredRef = useRef(onAuthExpired);

  useEffect(() => {
    onAuthExpiredRef.current = onAuthExpired;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setTimelineState("loading");
    getSessionTimeline(projectId, sessionId)
      .then((events) => {
        if (!active) return;
        setTimeline(events);
        setTimelineState("loaded");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          onAuthExpiredRef.current();
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setTimelineState("forbidden");
          return;
        }
        setTimelineState("error");
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
        {timelineState === "forbidden" ? (
          <p className="replay-error">이 프로젝트에 접근할 수 없습니다.</p>
        ) : timelineState === "error" ? (
          <p className="replay-error">세션 타임라인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        ) : (
          <SessionTimeline events={timeline} />
        )}
      </Card>
    </div>
  );
}
