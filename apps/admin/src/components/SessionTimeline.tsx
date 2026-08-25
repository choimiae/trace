import type { SessionTimelineEvent } from "@trace/shared";

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
              <time>{formatTime(event.timestamp)}</time>
              <div>
                <strong>{event.type}</strong>
                <span>{event.urlPath}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
