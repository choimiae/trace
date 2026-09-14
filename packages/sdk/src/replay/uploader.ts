import { redactUrl } from "@trace/shared/privacy";
import type { RecordedEvent } from "./buffer.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status?: number }>;

/**
 * 재시도가 계속 실패할 때 대기열이 무한히 자라지 않게 하는 상한. 넘으면
 * capPending() 이 트리밍한다 - 다만 이벤트 개수로 앞을 자르는 것이 아니라
 * 체크포인트 세대 단위로 자른다. 자세한 이유는 capPending() 주석을 본다.
 */
const MAX_PENDING_EVENTS = 20_000;

// rrweb 의 FullSnapshot 이벤트 타입 값. enum 을 들여오면 이 파일이 rrweb 에
// 의존하게 되므로(리플레이 번들은 rrweb 없이도 빌드·테스트되어야 한다),
// Task 13 코드와 같은 관례로 숫자를 그대로 쓴다.
const FULL_SNAPSHOT_EVENT_TYPE = 2;

// redactUrl 이 붙잡지 못하는 malformed 입력에 대비한 고정 대체값이다.
// z.string().url() 을 만족하면서도(따라서 서버 검증에서 거절되어 이벤트
// 전체를 잃는 일이 없으면서) 어떤 정보도 담지 않는다 - 원본 문자열로
// 되돌아가면 이 정정이 막으려는 유출(쿼리스트링 비밀)이 그대로 재현된다.
const FALLBACK_URL = "https://invalid.trace-sdk.internal/";

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// currentUrl() 이 기본값이든(window.location.href) 주입된 값이든 관계 없이,
// 이 함수를 거치지 않고는 어떤 URL 도 봉투에 들어가지 않는다. redactUrl 은
// new URL(...) 을 그대로 호출해 형식이 안 맞으면 던지므로 감싼다.
function safeCurrentUrl(rawUrl: string): string {
  try {
    const redacted = redactUrl(rawUrl);
    return `${redacted.origin}${redacted.urlPath}${redacted.urlQueryRedacted}`;
  } catch {
    return FALLBACK_URL;
  }
}

export class RecordingUploader {
  private pending: RecordedEvent[] = [];
  private seq = 0;
  private readonly compress: (bytes: Uint8Array) => Promise<Uint8Array>;
  private readonly fetcher: Fetcher;
  private readonly currentUrl: () => string;

  constructor(
    private readonly options: {
      endpoint: string;
      projectId: string;
      sdkVersion: string;
      compress?: (bytes: Uint8Array) => Promise<Uint8Array>;
      fetcher?: Fetcher;
      currentUrl?: () => string;
    },
  ) {
    this.compress = options.compress ?? gzip;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.currentUrl = options.currentUrl ?? (() => window.location.href);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(events: RecordedEvent[]): void {
    if (events.length === 0) return;
    this.pending.push(...events);
    this.capPending();
  }

  async flush(options: { keepalive?: boolean } = {}): Promise<boolean> {
    if (this.pending.length === 0) return true;

    const events = this.pending;
    this.pending = [];

    const body = JSON.stringify({
      projectId: this.options.projectId,
      seq: this.seq,
      startedAt: startedAt(events[0]!),
      url: safeCurrentUrl(this.currentUrl()),
      sdkVersion: this.options.sdkVersion,
      events,
    });

    try {
      const compressed = await this.compress(new TextEncoder().encode(body));
      const response = await this.fetcher(this.options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: compressed as BodyInit,
        // keepalive 는 64 KiB 한도가 있다. 기록 청크는 그보다 크므로 평상시에
        // 쓰면 네트워크 오류로 거절되어 영원히 재시도한다. 페이지를 떠나는
        // 마지막 한 번만 쓴다 - 그때는 보내지 못하는 것보다 잘리는 쪽이 낫다.
        ...(options.keepalive ? { keepalive: true } : {}),
      });

      if (!response.ok) {
        this.requeue(events);
        return false;
      }

      this.seq += 1;
      return true;
    } catch {
      // 네트워크 실패가 고객 사이트 사용자 경험에 영향을 주지 않아야 한다.
      this.requeue(events);
      return false;
    }
  }

  private requeue(events: RecordedEvent[]): void {
    this.pending = events.concat(this.pending);
    this.capPending();
  }

  /**
   * 상한을 넘으면 트리밍한다 - 다만 이벤트 개수로 앞을 자르지 않는다.
   * rrweb 델타는 체크포인트의 FullSnapshot 을 앵커로 재생되고, 그 스냅샷은
   * 큐에서 가장 오래된 축에 있다. 개수로 앞을 자르면 스냅샷이 먼저 잘려
   * 나가, 그 뒤 델타 최대 MAX_PENDING_EVENTS 개가 조용히(예외도, 실패하는
   * 테스트도 없이) 재생되지 않는 이벤트로 남는다.
   *
   * 그래서 여기서는 세대(직전 FullSnapshot 부터 다음 FullSnapshot 전까지)
   * 단위로만 자른다 - CheckpointBuffer 가 트리거 전에 오래된 세대를 통째로
   * 버리는 것과 같은 단위다. 상한을 만족시키는 가장 오래된 세대 경계를
   * 찾아 그 앞을 버리고, 그 세대까지도 상한을 넘으면(체크포인트가 한참
   * 오지 않은 채로 계속 실패해 쌓인 경우) 마지막 남은 세대는 아무리 커도
   * 남긴다 - 더 자르면 앵커 자체가 사라져 그동안 쌓인 델타 전체가
   * 재생되지 않는 이벤트로 전락한다. 다음 체크포인트가 오면 그 세대가 새
   * 경계가 되어 다시 상한 안으로 돌아온다.
   *
   * 스냅샷이 하나도 없으면(이미 앵커를 잃었거나, 그 앵커가 이전 flush 로
   * 이미 전달된 뒤라 지금 큐에는 델타만 남은 경우) 보호할 것이 없으니
   * 개수로 자른다.
   */
  private capPending(): void {
    if (this.pending.length <= MAX_PENDING_EVENTS) return;

    const generationStarts: number[] = [];
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i]!.type === FULL_SNAPSHOT_EVENT_TYPE) generationStarts.push(i);
    }

    if (generationStarts.length === 0) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_EVENTS);
      return;
    }

    let cut = generationStarts[generationStarts.length - 1]!;
    for (const start of generationStarts) {
      if (this.pending.length - start <= MAX_PENDING_EVENTS) {
        cut = start;
        break;
      }
    }

    if (cut > 0) this.pending.splice(0, cut);
  }
}

function startedAt(event: RecordedEvent): string {
  const at = new Date(event.timestamp);
  return Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
}
