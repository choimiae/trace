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
  // status 를 모르거나(fetcher 구현이 안 실어 준 경우) 0 이면(불투명
  // 응답이거나 전송 자체가 실패한 경우 - 서버의 판단이 아니다) 안전한 쪽 -
  // 재시도 - 로 처리한다. 408(Request Timeout)·429(Too Many Requests)는
  // 다시 보내면 성공할 수 있는 일시적 상태라 재시도 대상에 남긴다. 그 밖의
  // 4xx(403 replay_disabled/domain_not_allowed, 404 project_not_found,
  // 400 invalid_recording_chunk, 413 본문 초과 등)는 같은 청크를 다시
  // 보내도 서버가 항상 같은 이유로 거절하므로 영구 실패로 다룬다.
  if (status === undefined || status === 0) return true;
  if (status >= 500) return true;
  return status === 408 || status === 429;
}

interface Chunk {
  readonly seq: number;
  events: RecordedEvent[];
  // seq 와 달리 keepalive 는 claim 이후에도 바뀔 수 있다 - flush() 참고.
  keepalive: boolean;
}

export class RecordingUploader {
  // enqueue() 로 들어왔지만 아직 어떤 flush() 호출에도 claim 되지 않은
  // 이벤트 - 아직 seq 가 없다.
  private unclaimed: RecordedEvent[] = [];
  // claim 된(=seq 를 이미 받은) 배치들의 큐, 오래된 것이 앞이다. 아직
  // 서버에 확인받지 못한 것만 남는다 - 성공하면 즉시 빠진다.
  private outstanding: Chunk[] = [];
  private nextSeq = 0;
  private readonly compress: (bytes: Uint8Array) => Promise<Uint8Array>;
  private readonly fetcher: Fetcher;
  private readonly currentUrl: () => string;
  // flush() 가 이미 실행 중일 때 겹쳐 들어온 호출을 뒤에 잇는다(join 이
  // 아니라 chain). join 하면 이미 나가고 있는 요청을 그냥 같이 기다리는
  // 꼴이 되어, 그 요청이 이 두 번째 호출의 keepalive 옵션을 갖지 못한다 -
  // 페이지 이탈 시의 마지막 flush 가 keepalive 없이 나간 요청 뒤에 묻히면
  // 페이지가 닫히는 순간 함께 끊길 수 있다. chain 은 이전 것이 끝난 뒤에
  // 이번 호출만의 실제 요청을 새로 만들어 보낸다.
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
    return this.outstanding.reduce((sum, chunk) => sum + chunk.events.length, 0) + this.unclaimed.length;
  }

  enqueue(events: RecordedEvent[]): void {
    if (events.length === 0) return;
    this.unclaimed.push(...events);
    this.capPending();
  }

  async flush(options: { keepalive?: boolean } = {}): Promise<boolean> {
    const keepalive = !!options.keepalive;

    // keepalive 는 "이 배치를 누가 claim 했는가" 의 속성이 아니라 "지금 이
    // 순간 페이지가 사라지고 있는가" 의 속성이다(라운드 3). 이 호출이
    // keepalive 로 왔다면 - 아직 안 나간 배치가 이전의 일시적 실패로
    // backlog 에 남아 있더라도 - 지금부터 나가는 모든 배치가 keepalive 를
    // 져야 한다. 그러지 않으면 언로드가 그 배치의 요청을 끊어 버린다. 이미
    // 지나간(과거의) 시도는 되돌릴 수 없으니 건드리지 않는다 - 앞으로 나갈
    // 시도만 바꾼다.
    //
    // 켜는 것과 똑같이 끈다(라운드 4). keepalive flush 는 마지막이라는 보장이
    // 없다 - visibilitychange→hidden 도(이 SDK 자신의 트리거 패턴,
    // transport.ts 참고) bfcache 의 pagehide 도 페이지를 살려 둔 채 지나간다.
    // 한 번 켜고 두면 그 뒤의 평상시 flush 가 backlog 를 계속 keepalive 로
    // 보내고, 64 KiB 예산을 넘는 본문은 HTTP 상태가 아니라 네트워크 오류로
    // 거절되어(client.ts 참고) 그 청크가 머리에 영구히 눌러앉는다 - 아래
    // sendOne 의 주석이 막으려는 바로 그 결과다.
    for (const chunk of this.outstanding) chunk.keepalive = keepalive;

    // 새로 쌓인 이벤트가 있으면 지금 이 호출의 몫으로 배치를 하나 확정한다.
    // seq 는 여기서, 지금, 이 배치에 단 한 번만 부여된다 - claim 은 반드시
    // 동기적이어야 한다. 뒤의 체인(.then)에 미루면 그 사이에 들어오는
    // enqueue() 가 이번 호출이 아니라 다음 flush() 호출의 몫으로 새치기해
    // 들어가 두 호출이 서로의 이벤트를 나눠 갖게 된다.
    if (this.unclaimed.length > 0) {
      this.outstanding.push({ seq: this.nextSeq++, events: this.unclaimed, keepalive });
      this.unclaimed = [];
    }

    if (this.outstanding.length === 0) return true;

    const runNext = () => this.pump(keepalive);
    // 이전 체인이 어떻게 끝났든(pump() 는 내부에서 항상 boolean 으로
    // 정리하므로 reject 는 사실상 일어나지 않지만, 방어적으로 두 콜백 모두
    // runNext 를 잇는다) 이번 호출의 실제 전송 시도는 그 뒤에 실행된다.
    const chained: Promise<boolean> = (this.inFlight ?? Promise.resolve(true)).then(runNext, runNext);
    this.inFlight = chained;

    try {
      return await chained;
    } finally {
      // 그 사이 더 최신 호출이 체인을 이어받았다면 그 참조를 지우지 않는다.
      if (this.inFlight === chained) this.inFlight = null;
    }
  }

  /**
   * 큐 맨 앞(가장 오래된, 가장 작은 seq)부터 순서대로 하나씩 전송을
   * 시도한다. 성공하거나(영구 실패로 판단해) 버린 배치는 큐에서 빼고 다음
   * 배치로 계속 진행한다 - 겹친 flush() 호출이 쌓아 둔 뒤쪽 배치까지 이
   * 한 번의 pump 가 이어서 처리할 수 있다. 각 배치가 자신의 seq 를 스스로
   * 들고 있으므로 안전하다(claim 시점에 고정되고 다시 읽지 않는다).
   *
   * 평소(keepalive 아닌 flush())에는 재시도 가능한 실패를 만나면 그 배치를
   * 큐 맨 앞에 그대로 둔 채 멈춘다 - 지금 당장 또 두드려 봐야 결과가
   * 달라질 리 없으니, 다음 flush() 호출을 기다린다.
   *
   * keepalive(페이지 이탈)일 때는 멈추지 않는다 - 순서를 지키는 것은
   * "다음 flush() 가 온다" 는 미래가 있을 때만 의미가 있는데, 페이지가
   * 사라지는 지금은 그 미래가 없다. 앞 배치가 또 실패해도 계속 다음
   * 배치로 넘어가 - 뒤에 있는, 방금 이 호출이 claim 한 꼬리까지 - 시도할
   * 기회를 준다. 순서는 이미 seq 로 보장되어 있다(서버는 도착 순서가 아니라
   * seq 로 정렬한다) - 잃는 것은 엄격한 전송 순서뿐이고, 얻는 것은 실제로
   * 무언가를 내보낼 기회다.
   */
  private async pump(keepalive: boolean): Promise<boolean> {
    let delivered = true;
    // 어디까지 시도했는지를 위치(index)가 아니라 seq 로 기억한다. 위치로
    // 이어 가면 await 사이에 capPending() 이 이 자리 앞의 배치를 잘라내
    // 큐가 왼쪽으로 밀렸을 때 살아남은 배치를 정확히 하나 건너뛴다 -
    // 이탈 드레인에서는 그 배치를 다시 집어 줄 다음 flush() 가 없으므로
    // 그대로 사라진다. outstanding 은 seq 오름차순이므로(claim 이 뒤에만
    // 붙이고, 제거는 순서를 바꾸지 않는다) "이 seq 보다 큰 첫 배치" 가
    // 언제나 다음 대상이고, 이 값은 매 회 반드시 커지므로 루프도 끝난다.
    let lastSeq = -1;

    for (;;) {
      const index = this.outstanding.findIndex((candidate) => candidate.seq > lastSeq);
      if (index === -1) break;

      const chunk = this.outstanding[index]!;
      lastSeq = chunk.seq;
      const outcome = await this.sendOne(chunk);

      if (outcome === "retry") {
        delivered = false;
        if (!keepalive) return false;
        // 이 배치는 자리를 지킨다(다음 flush() 가 있다면 그때 같은 seq 로
        // 재시도한다) - 다만 지금은 멈추지 않고 다음 배치로 넘어간다.
        continue;
      }

      // 성공했거나 버렸다 - 큐에서 뺀다. capPending() 이 이 사이(await 중)
      // 이 배치를 이미 지웠을 수도 있으니 위치가 아니라 seq 로 찾는다 -
      // 못 찾아도 이미 처리된 것이니 안전하게 넘어간다.
      const at = this.outstanding.findIndex((candidate) => candidate.seq === chunk.seq);
      if (at !== -1) this.outstanding.splice(at, 1);
    }

    return delivered;
  }

  private async sendOne(chunk: Chunk): Promise<"delivered" | "dropped" | "retry"> {
    try {
      const body = JSON.stringify({
        projectId: this.options.projectId,
        seq: chunk.seq,
        startedAt: startedAt(chunk.events[0]!),
        url: safeCurrentUrl(this.currentUrl()),
        sdkVersion: this.options.sdkVersion,
        events: chunk.events,
      });

      const compressed = await this.compress(new TextEncoder().encode(body));

      if (compressed.byteLength > MAX_RECORDING_CHUNK_BYTES) {
        // 서버가 413 으로 거절할 것을 알면서 보내지 않는다 - 보내도 같은
        // 결과가 반복될 뿐이고(발견 3), 압축까지 마친 뒤에야 알 수 있으니
        // 여기서 판단한다. 이 배치는 이대로 버린다 - 나눠 보내는 기능은
        // 이 파일의 몫이 아니다.
        return "dropped";
      }

      const response = await this.fetcher(this.options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: compressed as BodyInit,
        // keepalive 는 64 KiB 한도가 있다. 기록 청크는 그보다 크므로 평상시에
        // 쓰면 네트워크 오류로 거절되어 영원히 재시도한다. 페이지를 떠나는
        // 마지막 한 번만 쓴다 - 그때는 보내지 못하는 것보다 잘리는 쪽이 낫다.
        ...(chunk.keepalive ? { keepalive: true } : {}),
      });

      if (!response.ok) {
        if (isRetryableStatus(response.status)) return "retry";
        // 영구 실패(예: 403 domain_not_allowed, 404 project_not_found) -
        // 다시 보내도 서버가 똑같이 거절한다. 큐에 남기면 이 배치가 머리에
        // 눌러앉아 그 뒤 모든 flush 가 매번 같은 응답을 받는다. 버린다.
        return "dropped";
      }

      return "delivered";
    } catch {
      // 네트워크 실패(또는 압축 실패)가 고객 사이트 사용자 경험에 영향을
      // 주지 않아야 한다.
      return "retry";
    }
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
   *
   * claim 되어 아직 전송되지 않은 배치(outstanding)도 unclaimed 와 함께
   * 하나의 논리적 순서로 본다 - 배치 경계는 flush() 가 호출된 타이밍일
   * 뿐, 체크포인트 세대와는 무관하므로 세대 하나가 배치 여러 개에 걸쳐
   * 있을 수 있다. 자르는 지점만 이 논리적 순서에서 계산하고, 실제로
   * 지우는 동작(dropFirst)이 배치 경계를 넘나든다.
   */
  private capPending(): void {
    const total =
      this.outstanding.reduce((sum, chunk) => sum + chunk.events.length, 0) + this.unclaimed.length;
    if (total <= MAX_PENDING_EVENTS) return;

    const generationStarts: number[] = [];
    let offset = 0;
    for (const chunk of this.outstanding) {
      for (let i = 0; i < chunk.events.length; i++) {
        if (chunk.events[i]!.type === FULL_SNAPSHOT_EVENT_TYPE) generationStarts.push(offset + i);
      }
      offset += chunk.events.length;
    }
    for (let i = 0; i < this.unclaimed.length; i++) {
      if (this.unclaimed[i]!.type === FULL_SNAPSHOT_EVENT_TYPE) generationStarts.push(offset + i);
    }

    let cut: number;
    if (generationStarts.length === 0) {
      cut = total - MAX_PENDING_EVENTS;
    } else {
      cut = generationStarts[generationStarts.length - 1]!;
      for (const start of generationStarts) {
        if (total - start <= MAX_PENDING_EVENTS) {
          cut = start;
          break;
        }
      }
    }

    this.dropFirst(cut);
  }

  private dropFirst(count: number): void {
    let remaining = count;
    while (remaining > 0 && this.outstanding.length > 0) {
      const chunk = this.outstanding[0]!;
      if (chunk.events.length <= remaining) {
        remaining -= chunk.events.length;
        this.outstanding.shift();
      } else {
        chunk.events.splice(0, remaining);
        remaining = 0;
      }
    }
    if (remaining > 0) this.unclaimed.splice(0, remaining);
  }
}

function startedAt(event: RecordedEvent): string {
  const at = new Date(event.timestamp);
  return Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
}
