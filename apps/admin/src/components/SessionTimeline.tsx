import type { SessionTimelineEvent } from "@trace/shared";
import { formatKoreanDateTime } from "../time.js";

export function SessionTimeline({ events }: { events: SessionTimelineEvent[] }) {
  return (
    <section className="timeline">
      <h2>세션 타임라인</h2>
      {events.length === 0 ? (
        <p className="empty-state">표시할 세션 이벤트가 없습니다.</p>
      ) : (
        <ol>
          {events.map((event) => (
            <li key={event.eventId}>
              <time>{formatKoreanDateTime(event.timestamp)}</time>
              <div>
                <div className="timeline-event-summary">
                  <strong>{event.type}</strong>
                  <span>{event.urlPath}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
