import { redactUrl } from "@trace/shared/privacy";
import type { EventBatch, TraceEvent } from "@trace/shared";
import { nanoid } from "nanoid";
import { Identity } from "./identity.js";
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

// 서버(`apps/api/src/routes/ingestion.ts` 의 `events.max(100)`)가 검증하는 배치 상한.
const MAX_BATCH_EVENTS = 100;

// 브라우저는 `keepalive` fetch 의 본문 크기를 제한한다(명세상 64 KiB). 넘으면 HTTP
// 상태가 아니라 네트워크 오류로 거절되므로 아래 catch 가 배치를 큐 앞으로 되돌리고,
// 큐가 다시 임계치를 넘어 다음 enqueue 가 같은 본문을 또 보낸다 — 위 isPermanentFailure
// 주석이 막으려던 바로 그 영구 head-of-line blocking 이다. 그래서 개수보다 먼저
// 직렬화 바이트 크기에서 걸리게 한다.
//
// 64 KiB 가 아니라 48 KiB 인 이유: 그 한도는 동시에 진행 중인 keepalive 요청들이
// 나눠 쓴다. 또 이 예산은 events 만의 것이 아니다 — 배치 봉투(projectId·sessionId·
// url·sentAt 등)도 같은 본문에 실린다. 봉투는 수백 바이트라 이 여유 안에서 흡수된다.
const MAX_BATCH_BODY_BYTES = 48 * 1024;

const textEncoder = new TextEncoder();

// String.length 는 문자 수라 한글이 섞이면 실제 UTF-8 바이트의 1/3 로 과소평가한다.
// 이 SDK 는 이미 fetch + keepalive 를 쓰므로 TextEncoder 가 없는 브라우저는 대상이
// 아니다 — 폴백을 두지 않는다.
function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).length;
}

export interface TraceClientOptions {
  projectId: string;
  endpoint: string;
  fetcher?: Fetcher;
  consent?: Consent;
  /** 세션·방문자 ID. 넘기지 않으면 저장하지 않는 메모리 ID 를 쓴다. */
  identity?: Identity;
}

export class TraceClient {
  private readonly projectId: string;
  private readonly endpoint: string;
  private readonly fetcher: Fetcher;
  private consent: Consent;
  private readonly identity: Identity;
  private readonly pageId = `page_${nanoid(10)}`;
  private queue: TraceEvent[] = [];
  private enqueueListeners: Array<() => void> = [];

  // 동의 보류에서 grant() 가 오면 저장된 세션을 이어 받아 바뀔 수 있다. 값을 들고
  // 있지 말고 부를 때마다 읽는다.
  get sessionId(): string {
    return this.identity.sessionId;
  }

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
    this.identity = options.identity ?? new Identity({ persist: false });
  }

  grantConsent() {
    this.consent = "granted";
    this.identity.persist();
  }

  denyConsent() {
    this.consent = "denied";
    this.queue = [];
    this.identity.forget();
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
    this.identity.touch();
    for (const listener of this.enqueueListeners) listener();
  }

  async flush() {
    if (this.consent !== "granted" || this.queue.length === 0) return;

    const redactedUrl = currentRedactedUrl();
    const events: TraceEvent[] = [];
    let bodyBytes = 0;
    for (const queued of this.queue) {
      if (events.length >= MAX_BATCH_EVENTS) break;
      const event: TraceEvent = {
        ...queued,
        urlPath: queued.urlPath || redactedUrl.urlPath,
        ...(queued.urlQueryRedacted
          ? { urlQueryRedacted: queued.urlQueryRedacted }
          : redactedUrl.urlQueryRedacted
            ? { urlQueryRedacted: redactedUrl.urlQueryRedacted }
            : {}),
      };
      const eventBytes = utf8ByteLength(JSON.stringify(event));
      // 이벤트 하나가 혼자 예산을 넘어도 그것만은 보낸다. 걸러 내면 그 이벤트가 큐
      // 맨 앞에서 영구히 막아 지금 고치려는 결함과 똑같아진다.
      if (events.length > 0 && bodyBytes + eventBytes > MAX_BATCH_BODY_BYTES) break;
      events.push(event);
      bodyBytes += eventBytes;
    }
    // 예산에 못 실은 나머지는 큐에 그대로 남아 다음 flush 에서 나간다.
    this.queue.splice(0, events.length);
    const batch: EventBatch = {
      projectId: this.projectId,
      anonymousUserId: this.identity.anonymousUserId,
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
