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
});
