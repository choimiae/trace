import { describe, expect, it, vi } from "vitest";
import { MAX_SCREEN_LAYOUT_HINTS, traceEventSchema, type TraceEvent } from "@trace/shared";
import { installCollectors } from "./collectors.js";
import { TraceClient } from "./client.js";

// 브라우저가 keepalive fetch 본문에 두는 한도(64 KiB)에서 다른 진행 중인 keepalive
// 요청 몫을 뺀 값. client.ts 의 MAX_BATCH_BODY_BYTES 와 같은 값을 일부러 여기에도
// 적는다 — 구현에서 읽어오면 상수를 잘못 키우는 회귀를 이 테스트가 못 잡는다.
const MAX_BATCH_BODY_BYTES = 48 * 1024;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// 실제 클릭 이벤트와 같은 모양으로 크기를 만든다. 힌트 예산이 20 → 50 이 되면서
// 이벤트 하나가 약 2.7KB → 약 5.3KB 가 된 것이 배치가 한도를 넘게 된 원인이다.
//
// 힌트 텍스트를 일부러 한글로 둔다. 한글은 UTF-8 로 글자당 3바이트인데
// String.length 는 1로 세므로, 크기를 문자 수로 재는 구현이면 예산을 크게 넘긴
// 본문을 만들어 낸다 — ASCII 픽스처였다면 그 구현도 이 테스트를 통과해 버린다.
// 그 대가로 힌트마다 글자가 실려 이벤트 하나가 약 13KB(실측 화면의 약 5.3KB 보다
// 크다). 예산에서 잘린다는 성질은 같고, 바이트/문자 비(약 1.28)가 판별력을 준다.
function clickEventWithHints(client: TraceClient, eventId: string, hintCount: number): TraceEvent {
  return client.createEvent({
    eventId,
    type: "click",
    urlPath: "/reports",
    metadata: {},
    screenContext: {
      viewport: { width: 1440, height: 900 },
      layoutHints: Array.from({ length: hintCount }, (_unused, index) => ({
        tagName: "button",
        role: "button",
        textMaskedOrLimited: `결재 문서함 상세 조회 화면에서 반려 사유를 입력하고 저장하는 버튼 ${index}`,
        selectorHash: index.toString(16).padStart(16, "0"),
        masked: false,
        rect: { x: index % 1440, y: (index * 7) % 900, width: 240, height: 64 },
      })),
    },
  });
}

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

  // 브라우저는 keepalive fetch 의 본문을 64 KiB 로 제한하고, 넘으면 HTTP 상태가
  // 아니라 네트워크 오류로 거절한다. 그러면 catch 가 배치를 큐 앞으로 되돌리고
  // 큐가 다시 임계치를 넘어 같은 본문을 또 보낸다 — 영구 head-of-line blocking 이다.
  // 개수(100)만으로는 못 막는다: 실측 화면의 이벤트(힌트 50개, 약 5.3KB)는 전송
  // 계층이 flush 하는 큐 20개만 모여도 약 106KB 다.
  it("배치 본문은 개수가 아니라 직렬화 바이트 예산에서 먼저 잘린다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    for (let index = 0; index < 20; index += 1) {
      client.enqueue(clickEventWithHints(client, `evt_${index.toString().padStart(10, "0")}`, MAX_SCREEN_LAYOUT_HINTS));
    }
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    // 픽스처가 실제로 멀티바이트인지 먼저 확인한다. ASCII 로 바뀌면 크기를 문자 수로
    // 재는 구현도 아래 단언을 통과해 버려 이 테스트가 조용히 무력해진다.
    expect(utf8ByteLength(body)).toBeGreaterThan(body.length * 1.2);
    expect(utf8ByteLength(body)).toBeLessThanOrEqual(MAX_BATCH_BODY_BYTES);
    // 개수 상한(100)에는 닿지도 않았다는 것 — 자른 것이 크기라는 증거다.
    const payload = JSON.parse(String(init.body)) as { events: TraceEvent[] };
    expect(payload.events.length).toBeLessThan(20);
    expect(payload.events.length).toBeGreaterThan(0);
  });

  it("예산 때문에 못 실은 이벤트는 큐에 남아 다음 flush 에서 나간다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    const eventIds = Array.from({ length: 20 }, (_unused, index) => `evt_${index.toString().padStart(10, "0")}`);
    for (const eventId of eventIds) {
      client.enqueue(clickEventWithHints(client, eventId, MAX_SCREEN_LAYOUT_HINTS));
    }
    await client.flush();

    expect(client.queueLength).toBeGreaterThan(0);

    const sent: string[] = [];
    while (client.queueLength > 0) await client.flush();
    for (const [, init] of fetcher.mock.calls as Array<[string, RequestInit]>) {
      const payload = JSON.parse(String(init.body)) as { events: Array<{ eventId: string }> };
      expect(utf8ByteLength(String(init.body))).toBeLessThanOrEqual(MAX_BATCH_BODY_BYTES);
      sent.push(...payload.events.map((event) => event.eventId));
    }

    // 하나도 잃지 않고, 큐에 들어온 순서 그대로 나간다.
    expect(sent).toEqual(eventIds);
  });

  // 예산에 걸러 내기만 하면 그 이벤트가 큐 맨 앞에 영원히 남아, 지금 고치려는
  // head-of-line blocking 과 똑같아진다. 혼자 넘치는 이벤트는 그것만 담아 보낸다.
  it("이벤트 하나가 혼자 예산을 넘어도 보내서 큐가 막히지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    // 계약 상한(50)을 넘는 힌트 수다. 정상 경로는 이런 이벤트를 만들지 않지만,
    // 어떻게든 커진 이벤트 하나가 큐를 영구히 막지 못한다는 것이 이 가드의 요지다.
    const oversized = clickEventWithHints(client, "evt_0000000000", 600);
    expect(utf8ByteLength(JSON.stringify(oversized))).toBeGreaterThan(MAX_BATCH_BODY_BYTES);
    client.enqueue(oversized);
    client.enqueue(clickEventWithHints(client, "evt_0000000001", MAX_SCREEN_LAYOUT_HINTS));

    await client.flush();

    const [, first] = fetcher.mock.calls[0] as [string, RequestInit];
    const firstPayload = JSON.parse(String(first.body)) as { events: Array<{ eventId: string }> };
    expect(firstPayload.events.map((event) => event.eventId)).toEqual(["evt_0000000000"]);

    // 뒤 이벤트도 막히지 않고 다음 flush 에서 나간다.
    await client.flush();

    const [, second] = fetcher.mock.calls[1] as [string, RequestInit];
    const secondPayload = JSON.parse(String(second.body)) as { events: Array<{ eventId: string }> };
    expect(secondPayload.events.map((event) => event.eventId)).toEqual(["evt_0000000001"]);
    expect(client.queueLength).toBe(0);
  });
});
