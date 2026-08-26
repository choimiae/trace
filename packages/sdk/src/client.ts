import { redactMetadata, redactUrl } from "@trace/shared/privacy";
import type { EventBatch, TraceEvent } from "@trace/shared";
import { nanoid } from "nanoid";
import type { Consent } from "./install.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<{ ok: boolean }>;

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

      if (!response.ok) this.queue.unshift(...batch.events);
    } catch {
      // 네트워크 실패가 고객 사이트 사용자 경험에 영향을 주지 않아야 한다.
      this.queue.unshift(...batch.events);
    }
  }
}

function currentRedactedUrl() {
  return redactUrl(window.location.href);
}
