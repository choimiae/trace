import { redactUrl } from "@trace/shared/privacy";
import { MAX_RECORDING_CHUNK_BYTES } from "@trace/shared/recording-limits";
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

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// currentUrl() 이 기본값이든(window.location.href) 주입된 값이든 관계 없이,
// 이 함수를 거치지 않고는 어떤 URL 도 봉투에 들어가지 않는다. redactUrl 은
// new URL(...) 을 그대로 호출해 형식이 안 맞으면 던지므로 감싼다.
//
// redactUrl 이 던지지 않아도 조합한 결과(origin+urlPath+urlQueryRedacted)가
// 유효한 URL 이 아닐 수 있다 - about:blank 는 origin 이 "null" 이라
// "nullblank" 가 되고, file: 은 "null/…" 이 된다. 서버는 이 문자열을 다시
// new URL() 로 파싱해 origin 을 allowedDomains 와 비교하므로, 여기서도 같은
// 검증을 통과하는지 미리 확인한다 - 안 그러면 400 이 되어 발견 3 이 다루는
// "영구 실패를 무한 재시도" 로 이어진다.
//
// 실패하면(redactUrl 이 던지거나, 조합 결과가 URL 로 파싱되지 않으면) 원본
// 문자열로 되돌아가지 않는다 - 이 정정이 막으려는 유출이 그대로 재현된다.
// 그렇다고 아무 고정 문자열도 안 된다 - 서버는 이 origin 이
// project.allowedDomains 에 있는지 검사하므로, 존재하지 않는 호스트로
// 되돌아가면 매 청크가 domain_not_allowed 로 영구히 거절되어 다시 발견
// 3 으로 이어진다. window.location.origin 은 지금 이 페이지가 이미 그
// 검사를 통과하고 있는 실제 값이고, 쿼리스트링이 없으니 비밀이 섞일 수도
// 없다.
function safeCurrentUrl(rawUrl: string): string {
  try {
    const redacted = redactUrl(rawUrl);
    const composed = `${redacted.origin}${redacted.urlPath}${redacted.urlQueryRedacted}`;
    new URL(composed);
    return composed;
  } catch {
    return window.location.origin;
  }
}

function isRetryableStatus(status: number | undefined): boolean {
  // status 를 모르면(fetcher 구현이 안 실어 준 경우) 안전한 쪽 - 재시도 -
  // 로 처리한다. 408(Request Timeout)·429(Too Many Requests)는 다시
  // 보내면 성공할 수 있는 일시적 상태라 재시도 대상에 남긴다. 그 밖의
  // 4xx(403 replay_disabled/domain_not_allowed, 404 project_not_found,
  // 400 invalid_recording_chunk, 413 본문 초과 등)는 같은 청크를 다시
  // 보내도 서버가 항상 같은 이유로 거절하므로 영구 실패로 다룬다.
  if (status === undefined) return true;
  if (status >= 500) return true;
  return status === 408 || status === 429;
}

export class RecordingUploader {
  private pending: RecordedEvent[] = [];
  private seq = 0;
  private readonly compress: (bytes: Uint8Array) => Promise<Uint8Array>;
  private readonly fetcher: Fetcher;
  private readonly currentUrl: () => string;
  // flush() 가 이미 실행 중일 때 겹쳐 들어온 호출을 뒤에 잇는다(join 이
  // 아니라 chain). join 하면 이미 나가고 있는 요청을 그냥 같이 기다리는
  // 꼴이 되어, 그 요청이 이 두 번째 호출의 keepalive 옵션을 갖지 못한다 -
  // 페이지 이탈 시의 마지막 flush 가 keepalive 없이 나간 요청 뒤에 묻히면
  // 페이지가 닫히는 순간 함께 끊길 수 있다. chain 은 이전 것이 끝난 뒤에
  // 이번 호출만의 실제 요청을 새로 만들어 보낸다 - 그래야 같은 seq 를 두
  // 번 쓰는 일도, keepalive 를 잃는 일도 없다.
  private inFlight: Promise<boolean> | null = null;

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

    // 이 호출 시점의 대기열만 이 flush 몫이다 - 스냅샷은 반드시 동기적으로
    // 떠야 한다. 아래 체인(.then)에 미루면 그 사이에 들어오는 enqueue() 가
    // 이번 호출이 아니라 다음 flush() 호출의 몫으로 새치기해 들어가
    // 두 호출이 서로의 이벤트를 나눠 갖게 된다 - 겹친 flush 테스트가 바로
    // 이 순서 착오를 잡아낸다. 실제로 미룰 것은 "언제 내보내느냐" 뿐이다.
    const events = this.pending;
    this.pending = [];

    const runNext = () => this.sendChunk(events, options);
    // 이전 체인이 성공했든 실패했든(sendChunk 는 내부에서 항상 boolean 으로
    // 정리하므로 reject 는 사실상 일어나지 않지만, 방어적으로 두 콜백 모두
    // runNext 를 잇는다) 이번 호출의 실제 요청은 그 뒤에 실행된다 - 그래야
    // this.seq 를 이전 호출이 올린 뒤의 값으로 읽고, 서로 다른 요청의
    // keepalive 를 잃지 않는다.
    const chained: Promise<boolean> = (this.inFlight ?? Promise.resolve(true)).then(runNext, runNext);
    this.inFlight = chained;

    try {
      return await chained;
    } finally {
      // 그 사이 더 최신 호출이 체인을 이어받았다면 그 참조를 지우지 않는다.
      if (this.inFlight === chained) this.inFlight = null;
    }
  }

  private async sendChunk(events: RecordedEvent[], options: { keepalive?: boolean }): Promise<boolean> {
    try {
      const body = JSON.stringify({
        projectId: this.options.projectId,
        seq: this.seq,
        startedAt: startedAt(events[0]!),
        url: safeCurrentUrl(this.currentUrl()),
        sdkVersion: this.options.sdkVersion,
        events,
      });

      const compressed = await this.compress(new TextEncoder().encode(body));

      if (compressed.byteLength > MAX_RECORDING_CHUNK_BYTES) {
        // 서버가 413 으로 거절할 것을 알면서 보내지 않는다 - 보내도 같은
        // 결과가 반복될 뿐이고(발견 3), 압축까지 마친 뒤에야 알 수 있으니
        // 여기서 판단한다. 이 청크는 이대로 버린다 - 나눠 보내는 기능은
        // 이 파일의 몫이 아니다.
        this.seq += 1;
        return true;
      }

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
        if (isRetryableStatus(response.status)) {
          this.requeue(events);
          return false;
        }
        // 영구 실패(예: 403 domain_not_allowed, 404 project_not_found) -
        // 다시 보내도 서버가 똑같이 거절한다. 큐에 다시 넣으면 이 청크가
        // 머리에 눌러앉아 그 뒤 모든 flush 가 매번 전체 큐를 다시 gzip 해
        // 같은 응답을 받는다. 대신 버리고 넘어간다.
        this.seq += 1;
        return true;
      }

      this.seq += 1;
      return true;
    } catch {
      // 네트워크 실패(또는 압축 실패)가 고객 사이트 사용자 경험에 영향을
      // 주지 않아야 한다.
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
