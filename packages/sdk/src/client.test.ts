import { describe, expect, it, vi } from "vitest";
import { installCollectors } from "./collectors.js";
import { TraceClient } from "./client.js";

describe("TraceClient", () => {
  it("does not send events when consent is denied", async () => {
    const fetcher = vi.fn();
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "denied",
    });

    client.track("report_export_clicked", { email: "choi@example.com" });
    await client.flush();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("redacts custom metadata and sends a sanitized batch when consent is granted", async () => {
    window.history.pushState({}, "", "/reports/123?email=choi@example.com&tab=export");
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    client.track("report_export_clicked", { email: "choi@example.com" });
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.url).toBe("http://localhost:3000/reports/:id?redacted_param_1=[redacted]&tab=[redacted]");
    expect(payload.events[0].metadata).toEqual({
      eventName: "report_export_clicked",
    });
    expect(payload.events[0].sessionId).toBe(payload.sessionId);
  });

  it("sends collector events with sanitized dynamic URL paths", async () => {
    window.history.pushState({}, "", "/users/123/settings?email=choi@example.com");
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    installCollectors(client);
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.events[0].type).toBe("page_view");
    expect(payload.events[0].urlPath).toBe("/users/:id/settings");
  });

  it("측정 불가한 뷰포트 크기는 보내지 않는다", async () => {
    // 숨은 iframe 이나 레이아웃 전에는 innerWidth/innerHeight 가 0 이다.
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    window.innerWidth = 0;
    window.innerHeight = 0;
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    installCollectors(client);
    document.body.innerHTML = `<button>저장</button>`;
    document.querySelector("button")!.click();
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    const click = payload.events.find((candidate: { type: string }) => candidate.type === "click");
    expect(click).toBeDefined();
    expect(click).not.toHaveProperty("viewportX");
    expect(click).not.toHaveProperty("viewportY");

    window.innerWidth = originalWidth;
    window.innerHeight = originalHeight;
  });

  it("sends screen context for click collector events", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://collector.example.com/ingest",
      fetcher,
      consent: "granted",
    });

    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = `<button id="save">저장</button>`;
    const button = document.querySelector("#save") as HTMLButtonElement;
    button.getBoundingClientRect = vi.fn(() => ({
      x: 620,
      y: 420,
      width: 96,
      height: 40,
      top: 420,
      left: 620,
      right: 716,
      bottom: 460,
      toJSON: () => ({}),
    }));

    installCollectors(client);
    button.click();
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as { events: Array<{ type: string; screenContext?: unknown }> };
    expect(payload.events.find((event) => event.type === "click")?.screenContext).toMatchObject({
      viewport: { width: 1440, height: 900 },
      target: {
        tagName: "button",
        role: "button",
        textMaskedOrLimited: "저장",
        rect: { x: 620, y: 420, width: 96, height: 40 },
      },
    });
  });

  it("영구 실패(4xx) 배치는 버려서 큐가 막히지 않게 한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    client.track("report_export_clicked");
    await client.flush();

    expect(client.queueLength).toBe(0);

    await client.flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("일시 실패(5xx) 배치는 큐에 되돌려 재시도한다", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    client.track("report_export_clicked");
    await client.flush();

    expect(client.queueLength).toBe(1);

    await client.flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.queueLength).toBe(0);
  });

  it.each([
    ["408 Request Timeout", 408],
    ["425 Too Early", 425],
    ["429 Too Many Requests", 429],
  ])("일시적인 4xx(%s)는 버리지 않고 재시도한다", async (_label, status) => {
    // CDN·WAF·프록시가 내는 코드다. 같은 배치를 다시 보내면 성공할 수 있으므로
    // 영구 실패로 묶어 버리면 멀쩡한 이벤트를 잃는다.
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status }).mockResolvedValueOnce({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    client.track("report_export_clicked");
    await client.flush();

    expect(client.queueLength).toBe(1);

    await client.flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.queueLength).toBe(0);
  });

  it("does not expose network failures and retries queued events", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    client.track("report_export_clicked");

    await expect(client.flush()).resolves.toBeUndefined();
    await client.flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetcher.mock.calls[1] as [string, RequestInit];
    const payload = JSON.parse(String(retryInit.body));
    expect(payload.events[0].metadata).toEqual({ eventName: "report_export_clicked" });
  });
});
