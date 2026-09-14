import { MAX_RECORDING_CHUNK_BYTES } from "@trace/shared/recording-limits";
import { describe, expect, it, vi } from "vitest";
import type { RecordedEvent } from "./buffer.js";
import { RecordingUploader } from "./uploader.js";

const identity = async (bytes: Uint8Array) => bytes;

// 브리프의 MAX_PENDING_EVENTS(20_000)를 이 테스트에서도 그대로 쓴다. 값을
// 바꿀 때는 여기도 같이 고친다.
const MAX_PENDING_EVENTS = 20_000;

function createUploader(
  fetcher: ReturnType<typeof vi.fn>,
  overrides: Partial<{ currentUrl: () => string }> = {},
) {
  return new RecordingUploader({
    endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
    projectId: "proj_1",
    sdkVersion: "0.1.0",
    compress: identity,
    fetcher: fetcher as never,
    currentUrl: overrides.currentUrl ?? (() => "https://demo.example.com/orders"),
  });
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as { body: Uint8Array };
  return JSON.parse(new TextDecoder().decode(init.body)) as Record<string, unknown>;
}

function initOf(call: unknown[]): RequestInit {
  return call[1] as RequestInit;
}

const event = (timestamp: number): RecordedEvent => ({ type: 3, timestamp });
const snapshot = (timestamp: number, extra: Record<string, unknown> = {}): RecordedEvent => ({
  type: 2,
  timestamp,
  ...extra,
});

describe("RecordingUploader", () => {
  // 이 계획에서 가장 중요한 불변식이다. 트리거가 없으면 아무것도 브라우저를
  // 떠나지 않는다.
  it("대기열이 비어 있으면 아무것도 보내지 않는다", async () => {
    const fetcher = vi.fn();
    const uploader = createUploader(fetcher);

    await uploader.flush();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("봉투에 프로젝트·순번·시작 시각·이벤트를 싣는다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1757808000000), event(1757808001000)]);

    await uploader.flush();

    const body = bodyOf(fetcher.mock.calls[0]!);
    expect(body.projectId).toBe("proj_1");
    expect(body.seq).toBe(0);
    expect(body.startedAt).toBe(new Date(1757808000000).toISOString());
    expect(body.url).toBe("https://demo.example.com/orders");
    expect(body.events).toHaveLength(2);
  });

  it("순번은 성공할 때만 올라간다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    await uploader.flush();
    uploader.enqueue([event(2)]);
    await uploader.flush();

    expect(bodyOf(fetcher.mock.calls[0]!).seq).toBe(0);
    expect(bodyOf(fetcher.mock.calls[1]!).seq).toBe(1);
  });

  // 실패한 구간을 버리면 재생에 구멍이 생긴다.
  it("실패하면 같은 순번으로 다음 flush 에서 다시 보낸다", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, status: 202 });
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    expect(await uploader.flush()).toBe(false);
    expect(uploader.pendingCount).toBe(1);

    expect(await uploader.flush()).toBe(true);
    expect(bodyOf(fetcher.mock.calls[1]!).seq).toBe(0);
  });

  it("네트워크가 던져도 고객 사이트로 오류를 흘리지 않는다", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    await expect(uploader.flush()).resolves.toBe(false);
    expect(uploader.pendingCount).toBe(1);
  });

  // keepalive 는 64 KiB 한도가 있다. 기록 청크는 그보다 훨씬 크므로 평상시에
  // 쓰면 네트워크 오류로 거절되어 영원히 재시도한다.
  it("평상시에는 keepalive 를 쓰지 않는다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    await uploader.flush();

    expect(initOf(fetcher.mock.calls[0]!).keepalive).toBeFalsy();
  });

  it("페이지를 떠날 때의 마지막 꼬리만 keepalive 로 보낸다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    await uploader.flush({ keepalive: true });

    expect(initOf(fetcher.mock.calls[0]!).keepalive).toBe(true);
  });

  it("content-type 은 octet-stream 이다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    await uploader.flush();

    const headers = initOf(fetcher.mock.calls[0]!).headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/octet-stream");
  });

  // --- 정정 1: URL 을 봉투에 넣기 전에 지운다 ---

  it("쿼리스트링에 담긴 비밀은 전송 본문에 남지 않는다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher, {
      currentUrl: () => "https://demo.example.com/orders?token=SECRET-VALUE&page=2",
    });
    uploader.enqueue([event(1)]);

    await uploader.flush();

    const body = bodyOf(fetcher.mock.calls[0]!);
    expect(body.url).not.toContain("SECRET-VALUE");
    // page 는 안전한 키라 이름은 남지만 값은 항상 [redacted]로 바뀐다 -
    // 수집 API(apps/api/src/routes/ingestion.ts)와 같은 redactUrl 합성이다.
    expect(body.url).toBe("https://demo.example.com/orders?redacted_param_1=[redacted]&page=[redacted]");
  });

  it("주입된 currentUrl 도 redactUrl 을 우회하지 못한다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    // currentUrl 이 기본값(window.location.href)이 아니라 주입된 값이어도
    // 정제가 적용되어야 한다 - 이 우회 경로를 막는 것이 정정 1의 요구사항이다.
    const uploader = createUploader(fetcher, {
      currentUrl: () => "https://demo.example.com/secure?password=hunter2",
    });
    uploader.enqueue([event(1)]);

    await uploader.flush();

    const body = bodyOf(fetcher.mock.calls[0]!);
    expect(body.url).not.toContain("hunter2");
  });

  it("currentUrl 이 URL 로 파싱되지 않아도 원본 문자열로 되돌아가지 않는다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher, {
      currentUrl: () => "not-a-url-at-all?leak=SECRET",
    });
    uploader.enqueue([event(1)]);

    await uploader.flush();

    const body = bodyOf(fetcher.mock.calls[0]!);
    expect(body.url).not.toBe("not-a-url-at-all?leak=SECRET");
    expect(body.url).not.toContain("SECRET");
    // 대체값도 z.string().url() 이 받는 유효한 URL 이어야 한다 - 그래야
    // 봉투 검증에서 청크 전체가 거절되지 않는다.
    expect(() => new URL(body.url as string)).not.toThrow();
  });

  // --- 정정 2: 상한이 스냅샷을 버리게 두지 않는다 ---

  it("새 체크포인트가 없으면 상한을 넘겨서라도 스냅샷을 지킨다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);

    uploader.enqueue([snapshot(0, { marker: "anchor" })]);
    uploader.enqueue(Array.from({ length: MAX_PENDING_EVENTS + 100 }, (_, i) => event(i + 1)));

    await uploader.flush();

    const events = bodyOf(fetcher.mock.calls[0]!).events as Record<string, unknown>[];
    // 상한(MAX_PENDING_EVENTS)을 넘겨서 총 MAX_PENDING_EVENTS + 101개가 그대로
    // 전달된다 - 이 세대의 유일한 스냅샷을 버리면 그 뒤 델타 전부가 재생되지
    // 않는 이벤트로 전락하므로, 다음 체크포인트가 올 때까지는 상한보다
    // 재생 가능성을 우선한다.
    expect(events).toHaveLength(MAX_PENDING_EVENTS + 101);
    expect(events[0]!.marker).toBe("anchor");
    expect(events[0]!.type).toBe(2);
  });

  it("새 체크포인트가 생기면 오래된 세대를 통째로 버려 상한을 회복한다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);

    // 오래된 세대: 스냅샷 하나 + 상한 전체를 채우는 델타.
    uploader.enqueue([snapshot(0, { marker: "old" })]);
    uploader.enqueue(Array.from({ length: MAX_PENDING_EVENTS - 1 }, (_, i) => event(i + 1)));
    // 새 체크포인트 - 새 세대가 시작된다.
    uploader.enqueue([snapshot(MAX_PENDING_EVENTS, { marker: "new" })]);
    // 새 세대의 델타. 지금까지 합은 상한을 한참 넘긴다.
    uploader.enqueue(Array.from({ length: 100 }, (_, i) => event(MAX_PENDING_EVENTS + i + 1)));

    await uploader.flush();

    const events = bodyOf(fetcher.mock.calls[0]!).events as Record<string, unknown>[];
    // 오래된 세대(스냅샷 + 델타 MAX_PENDING_EVENTS개)를 통째로 버리고, 새
    // 세대(스냅샷 + 델타 100개 = 101개)만 남아 상한을 훨씬 밑돈다.
    expect(events).toHaveLength(101);
    expect(events[0]!.marker).toBe("new");
    expect(events.some((e) => e.marker === "old")).toBe(false);
  });

  it("스냅샷이 없는 대기열은 개수로 자른다", () => {
    const fetcher = vi.fn();
    const uploader = createUploader(fetcher);

    // 스냅샷 없이 델타만 상한을 넘겨 쌓인 경우(예: 그 앵커가 이전 flush 로
    // 이미 전달된 뒤) - 보호할 스냅샷이 없으니 평범하게 개수로 자른다.
    uploader.enqueue(Array.from({ length: MAX_PENDING_EVENTS + 100 }, (_, i) => event(i)));

    expect(uploader.pendingCount).toBe(MAX_PENDING_EVENTS);
  });

  // --- 리뷰 라운드 1 ---

  // 발견 1: flush() 에 진행 중 가드가 없다 - 겹친 flush 가 같은 seq 를 중복시킨다.
  it("겹친 flush 는 seq 를 중복시키지 않는다", async () => {
    let resolveFirst!: (value: { ok: boolean; status?: number }) => void;
    const firstResponse = new Promise<{ ok: boolean; status?: number }>((resolve) => {
      resolveFirst = resolve;
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    const firstFlush = uploader.flush(); // 아직 응답이 오지 않았다.
    uploader.enqueue([event(2)]);
    const secondFlush = uploader.flush(); // 첫 번째가 끝나기 전에 호출된다.

    resolveFirst({ ok: true, status: 202 });
    await Promise.all([firstFlush, secondFlush]);

    expect(fetcher.mock.calls.length).toBe(2);
    expect(bodyOf(fetcher.mock.calls[0]!).seq).toBe(0);
    // 두 번째 flush 는 첫 번째가 seq 를 올린 뒤에야 실제로 실행되어야 한다 -
    // 그래야 같은 seq 를 두 번 보내 서버의 first-write-wins 에 한 청크를
    // 조용히 잃거나, 실패·성공 순서가 뒤바뀌어 seq 순서가 깨지지 않는다.
    expect(bodyOf(fetcher.mock.calls[1]!).seq).toBe(1);
  });

  it("겹친 flush 에서 keepalive 호출은 이미 큐에 있던 배치에도 적용된다", async () => {
    // 라운드 3 정정: keepalive 는 "이 배치를 누가 claim 했는가" 가 아니라
    // "지금 페이지가 사라지고 있는가" 의 속성이다. secondFlush 가
    // keepalive 로 호출되면, 아직 안 나간 첫 배치(firstFlush 가 claim 한,
    // 원래 keepalive 없던 배치)도 그 순간 함께 승격된다 - 그래야 언로드가
    // 그 요청을 끊어 버리지 않는다. 이 두 요청은 여전히 서로 다른 두 번의
    // fetch 다("겹친 flush 는 seq 를 중복시키지 않는다" 테스트가 보장하듯
    // join 이 아니라 chain 이라 하나로 뭉개지지 않는다) - 다만 라운드 1
    // 때와 달리 첫 번째 것도 이제 keepalive 를 진다.
    let resolveFirst!: (value: { ok: boolean; status?: number }) => void;
    const firstResponse = new Promise<{ ok: boolean; status?: number }>((resolve) => {
      resolveFirst = resolve;
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    const firstFlush = uploader.flush(); // keepalive 없음 - 아직 안 끝남.
    uploader.enqueue([event(2)]);
    const secondFlush = uploader.flush({ keepalive: true }); // 페이지 이탈 시의 마지막 flush.

    resolveFirst({ ok: true, status: 202 });
    await Promise.all([firstFlush, secondFlush]);

    expect(fetcher.mock.calls.length).toBe(2);
    expect(initOf(fetcher.mock.calls[0]!).keepalive).toBe(true);
    expect(initOf(fetcher.mock.calls[1]!).keepalive).toBe(true);
  });

  // 발견 2: 봉투 구성이 try 밖에 있었다 - 던지면 배치를 영구히 잃고 고객
  // 페이지로 예외가 흘렀다.
  it("currentUrl 이 던져도 이벤트를 잃지 않고 requeue 한다", async () => {
    const fetcher = vi.fn();
    const uploader = createUploader(fetcher, {
      currentUrl: () => {
        throw new Error("no location");
      },
    });
    uploader.enqueue([event(1)]);

    await expect(uploader.flush()).resolves.toBe(false);
    expect(uploader.pendingCount).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("직렬화할 수 없는 이벤트가 있어도 requeue 하고 잃지 않는다", async () => {
    const fetcher = vi.fn();
    const uploader = createUploader(fetcher);
    uploader.enqueue([{ type: 3, timestamp: 1, weird: 10n } as unknown as RecordedEvent]);

    await expect(uploader.flush()).resolves.toBe(false);
    expect(uploader.pendingCount).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  // 발견 3: 영구 실패 상태코드를 무한 재시도했다.
  it("영구 실패 상태코드(예: 403)는 청크를 버리고 seq 를 올린다", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 403 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    expect(await uploader.flush()).toBe(true);
    expect(uploader.pendingCount).toBe(0);

    // 같은 청크를 다시 보내지 않았다는 것을 seq 가 올라간 것으로 확인한다 -
    // 재시도했다면 여전히 seq 0 인 채로 큐 머리에 남아 있었을 것이다.
    fetcher.mockResolvedValueOnce({ ok: true, status: 202 });
    uploader.enqueue([event(2)]);
    await uploader.flush();
    expect(bodyOf(fetcher.mock.calls[1]!).seq).toBe(1);
  });

  it.each([408, 429])("상태코드 %d 는 영구 실패로 취급하지 않고 재시도한다", async (status) => {
    const fetcher = vi.fn(async () => ({ ok: false, status }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    expect(await uploader.flush()).toBe(false);
    expect(uploader.pendingCount).toBe(1);
  });

  it("status 가 없는 실패는 안전한 쪽(재시도)으로 처리한다", async () => {
    const fetcher = vi.fn(async () => ({ ok: false }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    expect(await uploader.flush()).toBe(false);
    expect(uploader.pendingCount).toBe(1);
  });

  // status 0 은 불투명 응답이나 전송 실패지 서버의 영구 거절이 아니다 -
  // undefined 와 같은 안전한 쪽으로 처리해야 한다.
  it("status 0 은 안전한 쪽(재시도)으로 처리한다", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 0 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    expect(await uploader.flush()).toBe(false);
    expect(uploader.pendingCount).toBe(1);
  });

  it("압축 후 크기가 상한을 넘으면 보내지 않고 버린다", async () => {
    const oversized = new Uint8Array(MAX_RECORDING_CHUNK_BYTES + 1);
    const fetcher = vi.fn();
    const uploader = new RecordingUploader({
      endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
      projectId: "proj_1",
      sdkVersion: "0.1.0",
      compress: async () => oversized,
      fetcher: fetcher as never,
      currentUrl: () => "https://demo.example.com/orders",
    });
    uploader.enqueue([event(1)]);

    // 서버가 413 으로 거절할 것을 아는 채로 보내지 않는다 - 보냈다면
    // fetcher 가 호출됐을 것이다.
    expect(await uploader.flush()).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(uploader.pendingCount).toBe(0);
  });

  // 참고 사항: 모든 다른 테스트는 compress 에 identity 를 주입해 기본
  // gzip() 경로를 가린다. CompressionStream 이 없는 실행 환경(구형
  // 브라우저 등)에서 기본 gzip() 이 실제로 어떻게 반응하는지는 이 테스트가
  // 유일하게 확인한다 - 이미 있던 catch-all 이 그대로 잡아 requeue 하므로
  // 코드 변경은 필요 없었다.
  it("기본 gzip() 이 던져도(CompressionStream 없는 환경) requeue 하고 오류를 흘리지 않는다", async () => {
    const original = (globalThis as { CompressionStream?: unknown }).CompressionStream;
    delete (globalThis as { CompressionStream?: unknown }).CompressionStream;

    try {
      const fetcher = vi.fn();
      const uploader = new RecordingUploader({
        endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
        projectId: "proj_1",
        sdkVersion: "0.1.0",
        // compress 를 주입하지 않는다 - 기본값(gzip)을 그대로 쓴다.
        fetcher: fetcher as never,
        currentUrl: () => "https://demo.example.com/orders",
      });
      uploader.enqueue([event(1)]);

      await expect(uploader.flush()).resolves.toBe(false);
      expect(uploader.pendingCount).toBe(1);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      (globalThis as { CompressionStream?: unknown }).CompressionStream = original;
    }
  });

  // 발견 4: FALLBACK_URL 이 항상 거절당했고, 조합한 URL 자체를 검증하지 않았다.
  it("currentUrl 이 파싱되지 않으면 지금 페이지의 origin 으로 되돌아간다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher, {
      currentUrl: () => "not-a-url-at-all?leak=SECRET",
    });
    uploader.enqueue([event(1)]);

    await uploader.flush();

    const body = bodyOf(fetcher.mock.calls[0]!);
    // window.location.origin 은 서버의 allowedDomains 검사가 실제로 비교하는
    // 값이다 - 절대 거절당하지 않는 고정 문자열이 아니라 이 값으로
    // 되돌아가야 재시도가 영원히 반복되지 않는다(발견 3).
    expect(body.url).toBe(window.location.origin);
    expect(body.url).not.toContain("SECRET");
  });

  it("redactUrl 이 던지지 않아도 조합한 URL 이 유효하지 않으면 origin 으로 되돌아간다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    // about:blank 는 new URL() 을 통과하지만(redactUrl 은 던지지 않는다),
    // origin 이 "null" 이라 origin+urlPath+urlQueryRedacted 를 조합하면
    // "nullblank" 가 되어 그 자체로는 유효한 URL 이 아니다.
    const uploader = createUploader(fetcher, { currentUrl: () => "about:blank" });
    uploader.enqueue([event(1)]);

    await uploader.flush();

    expect(bodyOf(fetcher.mock.calls[0]!).url).toBe(window.location.origin);
  });

  it("file: URL 의 비밀도 조합 실패 경로에서 새지 않는다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher, {
      currentUrl: () => "file:///Users/demo/secret.html?token=SECRET",
    });
    uploader.enqueue([event(1)]);

    await uploader.flush();

    const body = bodyOf(fetcher.mock.calls[0]!);
    expect(body.url).toBe(window.location.origin);
    expect(body.url).not.toContain("SECRET");
  });

  // --- 리뷰 라운드 2: 발견 1 재작업 (실패 경로에서 겹친 flush 가 seq 를 뒤섞는다) ---
  //
  // 1라운드의 in-flight 체인은 성공 경로만 고쳤다. seq 를 send 시점에 읽고
  // (this.seq), requeue() 가 실패한 배치를 pending 맨 앞에 되돌리는 한,
  // 겹친 flush 사이에 실패가 끼면 두 배치가 seq 를 나눠 갖지 못하고 하나로
  // 뭉개지거나 같은 seq 를 두 번 쓴다. 아래 세 테스트가 그 경로를 직접
  // 겨냥한다 - 현재 코드에서 실패하는 것을 먼저 확인했다.

  it("겹친 flush 에서 먼저 것이 재시도 가능하게 실패해도 seq 가 뒤섞이지 않는다", async () => {
    let resolveFirst!: (value: { ok: boolean; status?: number }) => void;
    const firstResponse = new Promise<{ ok: boolean; status?: number }>((resolve) => {
      resolveFirst = resolve;
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    const firstFlush = uploader.flush();
    uploader.enqueue([event(2)]);
    const secondFlush = uploader.flush();

    resolveFirst({ ok: false, status: 500 }); // 첫 배치(e1)가 재시도 가능하게 실패한다.
    await Promise.all([firstFlush, secondFlush]);

    const bodies = fetcher.mock.calls.map((call) => bodyOf(call));
    const bodiesWith = (timestamp: number) =>
      bodies.filter((body) => (body.events as RecordedEvent[]).some((e) => e.timestamp === timestamp));
    const e1Bodies = bodiesWith(1);
    const e2Bodies = bodiesWith(2);

    // e1 은 실패와 재시도를 통틀어 언제나 같은 seq 를 쓴다.
    expect(e1Bodies.length).toBeGreaterThanOrEqual(1);
    expect(new Set(e1Bodies.map((b) => b.seq)).size).toBe(1);
    // e2(더 최신)는 e1(더 오래된)보다 큰 seq 를 쓴다 - 절대 더 작은 값으로
    // 나가지 않는다.
    expect(e2Bodies.length).toBe(1);
    expect(e2Bodies[0]!.seq as number).toBeGreaterThan(e1Bodies[0]!.seq as number);
    // 어떤 청크도 e1 과 e2 를 함께 담지 않는다 - 서로 다른 seq 를 가져야 할
    // 두 배치가 하나로 뭉개지지 않는다.
    for (const body of bodies) {
      const events = body.events as RecordedEvent[];
      const hasBoth = events.some((e) => e.timestamp === 1) && events.some((e) => e.timestamp === 2);
      expect(hasBoth).toBe(false);
    }
  });

  it("겹친 flush 에서 먼저 것이 던져도 seq 가 뒤섞이지 않는다", async () => {
    let rejectFirst!: (error: unknown) => void;
    const firstResponse = new Promise<{ ok: boolean; status?: number }>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    const firstFlush = uploader.flush();
    uploader.enqueue([event(2)]);
    const secondFlush = uploader.flush();

    rejectFirst(new Error("offline")); // 첫 배치(e1)의 fetch 자체가 던진다.
    await Promise.all([firstFlush, secondFlush]);

    const bodies = fetcher.mock.calls.map((call) => bodyOf(call));
    const bodiesWith = (timestamp: number) =>
      bodies.filter((body) => (body.events as RecordedEvent[]).some((e) => e.timestamp === timestamp));
    const e1Bodies = bodiesWith(1);
    const e2Bodies = bodiesWith(2);

    expect(e1Bodies.length).toBeGreaterThanOrEqual(1);
    expect(new Set(e1Bodies.map((b) => b.seq)).size).toBe(1);
    expect(e2Bodies.length).toBe(1);
    expect(e2Bodies[0]!.seq as number).toBeGreaterThan(e1Bodies[0]!.seq as number);
    for (const body of bodies) {
      const events = body.events as RecordedEvent[];
      const hasBoth = events.some((e) => e.timestamp === 1) && events.some((e) => e.timestamp === 2);
      expect(hasBoth).toBe(false);
    }
  });

  it("재시도되는 배치는 원래 seq 를, 그 뒤에 claim 된 배치는 자신의 seq 를 그대로 지킨다", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, status: 202 });
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    expect(await uploader.flush()).toBe(false); // e1: seq 0 배정, 실패.

    uploader.enqueue([event(2)]);
    // 이 한 번의 flush() 호출이 밀린 e1 재시도와 새로 claim 된 e2 를 모두
    // 실어 나른다 - 둘은 서로 다른 seq 를 쓴다.
    expect(await uploader.flush()).toBe(true);

    expect(fetcher.mock.calls.length).toBe(3);
    const bodies = fetcher.mock.calls.map((call) => bodyOf(call));
    expect(bodies[0]!.seq).toBe(0);
    expect((bodies[0]!.events as RecordedEvent[])[0]!.timestamp).toBe(1);
    expect(bodies[1]!.seq).toBe(0); // 재시도 - 같은 seq.
    expect((bodies[1]!.events as RecordedEvent[])[0]!.timestamp).toBe(1);
    expect(bodies[2]!.seq).toBe(1); // 새로 claim 된 배치 - 자신의 seq.
    expect((bodies[2]!.events as RecordedEvent[])[0]!.timestamp).toBe(2);
  });

  // 재작업 과정에서 스스로 세운 불변식(4번: claim 되어 아직 전송되지 않은
  // 배치 안의 이벤트도 트리밍 보호 대상이다) 검증 - 요청받은 3개 테스트에는
  // 없지만, capPending() 이 이제 outstanding 청크 경계를 넘나들므로 직접
  // 확인한다.
  it("claim 되어 아직 전송되지 않은 배치 속 스냅샷도 트리밍이 그 경계를 넘어 보존한다", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 500 }));
    const uploader = createUploader(fetcher);

    uploader.enqueue([snapshot(0, { marker: "anchor" })]);
    // claim 되어 outstanding 에 들어가지만(seq 0), 전송은 실패해 그대로
    // 남는다 - 이제 이 스냅샷은 unclaimed 가 아니라 claim 된 배치 안에 있다.
    expect(await uploader.flush()).toBe(false);

    uploader.enqueue(Array.from({ length: MAX_PENDING_EVENTS + 100 }, (_, i) => event(i + 1)));

    fetcher.mockResolvedValue({ ok: true, status: 202 });
    await uploader.flush();

    // calls[0] = 첫 실패 시도(스냅샷만). calls[1] = 그 배치의 재시도(성공) -
    // 트리밍이 배치 경계를 몰랐다면 이 스냅샷이 통째로 사라졌을 자리다.
    const retriedEvents = bodyOf(fetcher.mock.calls[1]!).events as Record<string, unknown>[];
    expect(retriedEvents).toHaveLength(1);
    expect(retriedEvents[0]!.marker).toBe("anchor");
  });

  // --- 리뷰 라운드 3: 발견 - backlog 가 있을 때 페이지 이탈 꼬리를 잃는다 ---
  //
  // 라운드 2 는 keepalive 를 claim 시점에 배치에 고정했지만, 그 배치를
  // "누가 claim 했는가" 로만 정했다. 실제로는 "지금 페이지가 사라지고
  // 있는가" 가 keepalive 를 결정해야 한다 - 이전의 일시적 실패로 backlog 가
  // 남아 있으면, 그 배치가 keepalive 없이 나가다 언로드에 끊기고, pump() 는
  // 첫 재시도 가능한 실패에서 멈춰 정작 페이지 이탈 flush 가 claim 한
  // 꼬리는 시도조차 되지 않는다.

  it("페이지 이탈 시 이미 쌓인 backlog 도 keepalive 로 나간다", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 }) // 이전의 일시적 실패 - backlog 를 남긴다.
      .mockResolvedValue({ ok: true, status: 202 });
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    expect(await uploader.flush()).toBe(false); // e1 이 seq 0 로 실패한 채 backlog 에 남는다 - keepalive 없이.

    uploader.enqueue([event(2)]);
    await uploader.flush({ keepalive: true }); // 페이지가 지금 사라지고 있다.

    expect(fetcher.mock.calls.length).toBe(3);
    // calls[0] 은 keepalive 호출보다 앞서 이미 지나간 시도라 keepalive 가
    // 없다 - 그건 되돌릴 수 없다. 하지만 keepalive 호출 이후에 나간 모든
    // 요청은 - 밀린 e1 의 재시도(calls[1])든 새로 claim 된 e2(calls[2])든 -
    // 반드시 keepalive 를 실어야 한다.
    expect(initOf(fetcher.mock.calls[1]!).keepalive).toBe(true);
    expect(initOf(fetcher.mock.calls[2]!).keepalive).toBe(true);
  });

  it("backlog 가 keepalive 시도에서도 계속 실패해도 새 배치(꼬리)는 시도된다", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 500 })); // 계속 실패한다 - 성공은 이 테스트의 관심사가 아니다.
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    expect(await uploader.flush()).toBe(false); // backlog 남음.

    uploader.enqueue([event(2)]);
    await uploader.flush({ keepalive: true });

    // 밀린 e1 이 keepalive 재시도에서도 또 실패하더라도, 새로 claim 된
    // e2(꼬리)는 반드시 시도되어야 한다 - 순서를 지키려고 여기서 멈추면
    // keepalive 가 존재하는 유일한 이유(마지막 꼬리 저장)를 잃는다. 순서는
    // seq 로 이미 보장되어 있고(서버는 seq 로 정렬한다), 지금은 이 배치를
    // 시도할 미래의 flush() 가 없다.
    expect(fetcher.mock.calls.length).toBe(3); // e1(최초 실패) + e1(keepalive 재시도, 또 실패) + e2(꼬리, keepalive).
    const tailCall = fetcher.mock.calls[2]!;
    expect((bodyOf(tailCall).events as RecordedEvent[])[0]!.timestamp).toBe(2);
    expect(initOf(tailCall).keepalive).toBe(true);
  });
});
