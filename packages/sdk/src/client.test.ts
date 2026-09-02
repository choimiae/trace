import { describe, expect, it, vi } from "vitest";
import { traceEventSchema } from "@trace/shared";
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

  it("오류 이벤트에 종류·스크립트 경로·라인을 싣는다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    installCollectors(client);
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("Cannot read property 'id' of undefined"),
        filename: "https://app.example.com/assets/checkout.js?v=2",
        lineno: 412,
        message: "Cannot read property 'id' of undefined",
      }),
    );
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as { events: Array<Record<string, unknown>> };
    const error = payload.events.find((event) => event.type === "js_error");

    expect(error?.errorName).toBe("TypeError");
    expect(error?.errorSource).toBe("/assets/checkout.js");
    expect(error?.errorLine).toBe(412);
    // 메시지와 스택은 어디에도 실리지 않는다.
    expect(JSON.stringify(payload)).not.toContain("Cannot read property");
  });

  it("정상 오류는 세 필드를 모두 담고, cross-origin 오류(error 없음, filename 빈 값)는 모두 생략한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    installCollectors(client);
    // 양성 대조군: 정상적인 오류는 세 필드가 반드시 실려야 한다.
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("Cannot read property 'id' of undefined"),
        filename: "https://app.example.com/assets/checkout.js?v=2",
        lineno: 412,
        message: "Cannot read property 'id' of undefined",
      }),
    );
    // 음성 대조군: cross-origin 오류는 세 필드가 모두 생략되어야 한다.
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error.", filename: "", lineno: 0 }));
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as { events: Array<Record<string, unknown>> };
    const errors = payload.events.filter((event) => event.type === "js_error");
    expect(errors).toHaveLength(2);

    const [wellFormed, crossOrigin] = errors;
    expect(wellFormed?.errorName).toBe("TypeError");
    expect(wellFormed?.errorSource).toBe("/assets/checkout.js");
    expect(wellFormed?.errorLine).toBe(412);

    expect(crossOrigin).not.toHaveProperty("errorName");
    expect(crossOrigin).not.toHaveProperty("errorSource");
    expect(crossOrigin).not.toHaveProperty("errorLine");
  });

  it("errorSource 는 계약을 어길 수 있는 산출물(과도한 길이·선행 슬래시 없는 경로)을 생략한다 — traceEventSchema 로 왕복 검증", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    installCollectors(client);

    const cases: Array<{ filename: string; expectSource: string | undefined }> = [
      { filename: "https://app.example.com/assets/checkout.js?v=2", expectSource: "/assets/checkout.js" },
      { filename: `https://app.example.com/${"a".repeat(300)}.js`, expectSource: undefined },
      { filename: "data:text/javascript,alert(1)", expectSource: undefined },
      { filename: "about:blank", expectSource: undefined },
    ];

    for (const { filename } of cases) {
      window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("x"), filename, lineno: 10 }));
    }
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as { events: Array<Record<string, unknown>> };
    const errors = payload.events.filter((event) => event.type === "js_error");
    expect(errors).toHaveLength(cases.length);

    errors.forEach((event, index) => {
      const expectSource = cases[index]?.expectSource;
      if (expectSource === undefined) {
        expect(event).not.toHaveProperty("errorSource");
      } else {
        expect(event.errorSource).toBe(expectSource);
      }
      // 산출물이 서버 계약을 실제로 만족하는지 왕복 검증한다 — 이 체크가 없었던
      // 것이 safeErrorSource 가 계약 위반 값을 그대로 흘려보내는 결함을 놓친 원인이었다.
      expect(traceEventSchema.safeParse(event).success).toBe(true);
    });
  });
});
