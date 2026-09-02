import { redactMetadata, redactUrl } from "@trace/shared/privacy";
import type { EventBatch, TraceEvent } from "@trace/shared";
import { nanoid } from "nanoid";
import type { Consent } from "./install.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status?: number }>;

// CDN·WAF·프록시가 내는 일시적인 4xx. 같은 배치를 다시 보내면 성공할 수 있으므로
// 영구 실패로 묶어 버리면 멀쩡한 이벤트를 잃는다.
const TRANSIENT_STATUSES = new Set([
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests
]);

// 그 밖의 4xx 는 같은 배치를 다시 보내도 같은 응답이 온다. 큐 앞으로 되돌리면 이후
// 이벤트가 영구히 막히고(head-of-line blocking) 클릭마다 POST 가 나가므로 버린다.
function isPermanentFailure(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status >= 400 && status < 500 && !TRANSIENT_STATUSES.has(status);
}

export interface TraceClientOptions {
  projectId: string;
  endpoint: string;
  fetcher?: Fetcher;
  consent?: Consent;
}

export class TraceClient {
  private readonly projectId: string;
  private readonly endpoint: string;
  private readonly fetcher: Fetcher;
  private consent: Consent;
  private readonly anonymousUserId = `anon_${nanoid(10)}`;
  private readonly sessionId = `sess_${nanoid(10)}`;
  private readonly pageId = `page_${nanoid(10)}`;
  private queue: TraceEvent[] = [];
  private enqueueListeners: Array<() => void> = [];

  get queueLength(): number {
    return this.queue.length;
  }

  onEnqueue(listener: () => void): void {
    this.enqueueListeners.push(listener);
  }

  constructor(options: TraceClientOptions) {
    this.projectId = options.projectId;
    this.endpoint = options.endpoint;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.consent = options.consent ?? "granted";
  }

  grantConsent() {
    this.consent = "granted";
  }

  denyConsent() {
    this.consent = "denied";
    this.queue = [];
  }

  track(name: string, metadata: Record<string, unknown> = {}) {
    const redactedUrl = currentRedactedUrl();

    this.enqueue(
      this.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "custom_event",
        urlPath: redactedUrl.urlPath,
        ...(redactedUrl.urlQueryRedacted ? { urlQueryRedacted: redactedUrl.urlQueryRedacted } : {}),
        metadata: redactMetadata({ name, ...metadata }),
      }),
    );
  }

  createEvent(event: Omit<TraceEvent, "sessionId" | "pageId" | "timestamp"> & { timestamp?: string }): TraceEvent {
    return {
      ...event,
      sessionId: this.sessionId,
      pageId: this.pageId,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
  }

  enqueue(event: TraceEvent) {
    if (this.consent !== "granted") return;
    this.queue.push(event);
    for (const listener of this.enqueueListeners) listener();
  }

  async flush() {
    if (this.consent !== "granted" || this.queue.length === 0) return;

    const redactedUrl = currentRedactedUrl();
    const events = this.queue.splice(0, 100).map((event) => ({
      ...event,
      urlPath: event.urlPath || redactedUrl.urlPath,
      ...(event.urlQueryRedacted
        ? { urlQueryRedacted: event.urlQueryRedacted }
        : redactedUrl.urlQueryRedacted
          ? { urlQueryRedacted: redactedUrl.urlQueryRedacted }
          : {}),
    }));
    const batch: EventBatch = {
      projectId: this.projectId,
      anonymousUserId: this.anonymousUserId,
      sessionId: this.sessionId,
      sentAt: new Date().toISOString(),
      sdkVersion: "0.1.0",
      url: `${redactedUrl.origin}${redactedUrl.urlPath}${redactedUrl.urlQueryRedacted}`,
      events,
    };

    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
        keepalive: true,
      });

      if (!response.ok && !isPermanentFailure(response.status)) this.queue.unshift(...batch.events);
    } catch {
      // 네트워크 실패가 고객 사이트 사용자 경험에 영향을 주지 않아야 한다.
      this.queue.unshift(...batch.events);
    }
  }
}

function currentRedactedUrl() {
  return redactUrl(window.location.href);
}
