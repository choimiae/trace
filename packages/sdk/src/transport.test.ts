import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceClient } from "./client.js";
import { installTransport } from "./transport.js";

function createClient(fetcher: ReturnType<typeof vi.fn>) {
  return new TraceClient({
    projectId: "proj_1",
    endpoint: "https://trace.example.com/v1/events/batch",
    fetcher,
    consent: "granted",
  });
}

function enqueueOne(client: TraceClient, eventId: string) {
  client.enqueue(
    client.createEvent({
      eventId,
      type: "click",
      urlPath: "/settings",
      metadata: {},
    }),
  );
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("installTransport", () => {
  let teardown: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    vi.useRealTimers();
  });

  it("주기 타이머가 큐를 전송한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000 });

    enqueueOne(client, "evt_1");
    expect(fetcher).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.queueLength).toBe(0);
  });

  it("큐가 비어 있으면 타이머가 전송하지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000 });

    await vi.advanceTimersByTimeAsync(15000);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("큐 임계치에 도달하면 즉시 전송한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000, queueThreshold: 3 });

    enqueueOne(client, "evt_1");
    enqueueOne(client, "evt_2");
    expect(fetcher).not.toHaveBeenCalled();

    enqueueOne(client, "evt_3");
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("화면이 가려지면 전송한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000 });

    enqueueOne(client, "evt_1");
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("페이지를 떠날 때 전송한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000 });

    enqueueOne(client, "evt_1");
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("teardown 이후에는 전송하지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    const stop = installTransport(client, { intervalMs: 5000 });

    enqueueOne(client, "evt_1");
    stop();
    await vi.advanceTimersByTimeAsync(15000);
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("TraceClient 전송 실패 격리", () => {
  it("네트워크 예외를 호출부로 전파하지 않고 큐를 복원한다", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));
    const client = createClient(fetcher);

    enqueueOne(client, "evt_1");
    await expect(client.flush()).resolves.toBeUndefined();
    expect(client.queueLength).toBe(1);
  });

  it("응답이 실패면 큐를 복원한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    const client = createClient(fetcher);

    enqueueOne(client, "evt_1");
    await client.flush();

    expect(client.queueLength).toBe(1);
  });
});
