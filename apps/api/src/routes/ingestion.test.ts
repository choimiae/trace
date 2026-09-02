import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { MemoryStore } from "../store/memory-store.js";

describe("ingestion routes", () => {
  it("accepts a valid raw batch from an allowed domain and stores sanitized events", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/users/123/settings?email=choi@example.com&tab=invite",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "custom_event",
            metadata: {
              name: "member_invite_started",
              email: "choi@example.com",
              nested: { phone: "010-1234-5678" },
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 1 });
    const events = await store.listEvents(project.projectId);
    expect(events[0]?.urlPath).toBe("/users/:id/settings");
    expect(events[0]?.urlQueryRedacted).toBe("?redacted_param_1=[redacted]&tab=[redacted]");
    expect(events[0]?.metadata).toEqual({ eventName: "member_invite_started" });
  });

  it("does not store unsafe raw identifiers or element labels", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "choi@example.com",
        sessionId: "choi@example.com",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "choi@example.com",
            sessionId: "choi@example.com",
            pageId: "sk_live_abcDEF",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "button choi@example.com",
            elementRole: "button choi@example.com",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const [event] = await store.listEvents(project.projectId);
    expect(event?.eventId).toMatch(/^evt_/);
    expect(event?.sessionId).toMatch(/^sess_/);
    expect(event?.pageId).toMatch(/^page_/);
    expect(event?.elementSelectorHash).toBeUndefined();
    expect(event?.elementRole).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("choi@example.com");
    expect(JSON.stringify(event)).not.toContain("sk_live");
  });

  it("preserves each event's sanitized URL path within a mixed-page batch", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            urlPath: "/users/alice/settings",
            metadata: {},
          },
          {
            eventId: "evt_2",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            urlPath: "/reports/123",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const events = await store.listEvents(project.projectId);
    expect(events.map((event) => event.urlPath)).toEqual(["/users/:id/settings", "/reports/:id"]);
  });

  it("stores safe screen context from ingested events", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "저장",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline[0]?.screenContext?.target?.textMaskedOrLimited).toBe("저장");
  });

  it("마스킹되지 않은 화면 맥락 텍스트는 배치를 거절하지 않고 다시 마스킹한다", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "user@example.com",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline[0]?.screenContext?.target?.textMaskedOrLimited).toBe("[redacted]");
  });

  it("일상적인 고객 DOM 에서 온 화면 맥락을 거절하지 않고 정리해서 저장한다", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });
    // redactText 를 1회만 적용한 제목. 자체 slice(0, 120) 경계 때문에 아직
    // 마스킹 대상이 남아 있어 screenContextSchema 를 그대로는 통과하지 못한다.
    const onceRedactedTitle = `${"가".repeat(107)}1234567890123`;

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_hostile",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              titleMasked: onceRedactedTitle,
              viewport: { width: 1440.4, height: 900 },
              target: {
                tagName: "DIV",
                role: "none presentation",
                selectorHash: "not a hash",
                rect: { x: -20, y: 0, width: 12000, height: 30000 },
              },
              layoutHints: Array.from({ length: 20 }, (_unused, index) => ({
                tagName: "section",
                masked: true,
                rect: { x: index, y: index, width: 40, height: 40 },
              })),
            },
          },
          {
            eventId: "evt_ok",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              titleMasked: "설정",
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "저장",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 2 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline.map((event) => event.eventId)).toEqual(["evt_hostile", "evt_ok"]);
    expect(timeline[0]?.screenContext).toMatchObject({
      titleMasked: `${"가".repeat(107)}[redacted]`,
      viewport: { width: 1440, height: 900 },
      target: {
        tagName: "div",
        rect: { x: 0, y: 0, width: 10000, height: 10000 },
      },
    });
    expect(timeline[0]?.screenContext?.target).not.toHaveProperty("role");
    expect(timeline[0]?.screenContext?.target).not.toHaveProperty("selectorHash");
    expect(timeline[0]?.screenContext?.layoutHints).toHaveLength(12);
    expect(timeline[1]?.screenContext?.target?.textMaskedOrLimited).toBe("저장");
  });

  it("masked 힌트가 텍스트를 실어 보내도 서버가 텍스트를 지운다", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: { tagName: "button", rect: { x: 10, y: 10, width: 90, height: 40 } },
              layoutHints: [
                {
                  tagName: "textarea",
                  masked: true,
                  textMaskedOrLimited: "고객 메모 원문",
                  rect: { x: 20, y: 60, width: 400, height: 120 },
                },
                {
                  tagName: "a",
                  masked: false,
                  textMaskedOrLimited: "도움말",
                  rect: { x: 20, y: 200, width: 80, height: 24 },
                },
              ],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    const hints = timeline[0]?.screenContext?.layoutHints ?? [];
    const masked = hints.find((hint) => hint.tagName === "textarea");
    const link = hints.find((hint) => hint.tagName === "a");

    expect(masked?.masked).toBe(true);
    expect(masked).not.toHaveProperty("textMaskedOrLimited");
    expect(link?.textMaskedOrLimited).toBe("도움말");
    expect(JSON.stringify(timeline)).not.toContain("고객 메모 원문");
  });

  it("구식 SDK 가 masked:false 로 보낸 입력 계열·컨테이너 텍스트도 서버가 태그·역할로 직접 판정해 지운다", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: { tagName: "button", rect: { x: 10, y: 10, width: 90, height: 40 } },
              layoutHints: [
                {
                  tagName: "input",
                  masked: false,
                  textMaskedOrLimited: "hunter2Password",
                  rect: { x: 20, y: 60, width: 200, height: 32 },
                },
                {
                  tagName: "select",
                  masked: false,
                  textMaskedOrLimited: "선택된 옵션 라벨",
                  rect: { x: 20, y: 100, width: 200, height: 32 },
                },
                {
                  tagName: "main",
                  masked: false,
                  textMaskedOrLimited: "김철수 고객 상세 화면",
                  rect: { x: 0, y: 0, width: 1440, height: 900 },
                },
                {
                  tagName: "a",
                  masked: false,
                  textMaskedOrLimited: "도움말",
                  rect: { x: 20, y: 200, width: 80, height: 24 },
                },
              ],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    const hints = timeline[0]?.screenContext?.layoutHints ?? [];
    const input = hints.find((hint) => hint.tagName === "input");
    const select = hints.find((hint) => hint.tagName === "select");
    const main = hints.find((hint) => hint.tagName === "main");
    const link = hints.find((hint) => hint.tagName === "a");
    const serialized = JSON.stringify(timeline);

    expect(input?.masked).toBe(true);
    expect(input).not.toHaveProperty("textMaskedOrLimited");
    expect(select?.masked).toBe(true);
    expect(select).not.toHaveProperty("textMaskedOrLimited");
    expect(main?.masked).toBe(false);
    expect(main).not.toHaveProperty("textMaskedOrLimited");
    expect(link?.masked).toBe(false);
    expect(link?.textMaskedOrLimited).toBe("도움말");
    expect(serialized).not.toContain("hunter2Password");
    expect(serialized).not.toContain("선택된 옵션 라벨");
    expect(serialized).not.toContain("김철수 고객 상세 화면");
    expect(serialized).toContain("도움말");
  });

  it("힌트의 masked 가 불린이 아니면 화면 맥락 전체를 버리고도 배치는 받는다 (fail-closed 회귀 고정)", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const makeEvent = (eventId: string, layoutHint: Record<string, unknown>) => ({
      eventId,
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click",
      urlPath: "/settings",
      metadata: {},
      screenContext: {
        viewport: { width: 1440, height: 900 },
        layoutHints: [layoutHint],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          makeEvent("evt_masked_missing", { tagName: "div", rect: { x: 0, y: 0, width: 10, height: 10 } }),
          makeEvent("evt_masked_string", {
            tagName: "div",
            masked: "true",
            rect: { x: 0, y: 0, width: 10, height: 10 },
          }),
          makeEvent("evt_masked_null", {
            tagName: "div",
            masked: null,
            rect: { x: 0, y: 0, width: 10, height: 10 },
          }),
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 3 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline.map((event) => event.eventId)).toEqual([
      "evt_masked_missing",
      "evt_masked_string",
      "evt_masked_null",
    ]);
    expect(timeline[0]?.screenContext).toBeUndefined();
    expect(timeline[1]?.screenContext).toBeUndefined();
    expect(timeline[2]?.screenContext).toBeUndefined();
  });

  it("복구할 수 없는 화면 맥락은 필드만 버리고 같은 배치의 다른 이벤트를 저장한다", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_broken",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: "화면 맥락 아님",
          },
          {
            eventId: "evt_ok",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "저장",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 2 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).not.toHaveProperty("screenContext");
    expect(timeline[1]?.screenContext?.target?.textMaskedOrLimited).toBe("저장");
  });

  it("측정 불가한 뷰포트 크기는 배치를 거절하지 않고 필드만 버린다", async () => {
    // SDK 는 window.innerWidth/innerHeight 를 무조건 보낸다. 숨은 iframe 이나
    // 레이아웃 전에는 0 이고, 브라우저 확대 상태에서는 소수가 될 수 있다.
    // 어느 쪽도 배치 전체를 400 으로 떨어뜨려서는 안 된다.
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:03.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_hidden_iframe",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            viewportX: 0,
            viewportY: 0,
            metadata: {},
          },
          {
            eventId: "evt_zoomed",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            viewportX: 1279.5,
            viewportY: 719.5,
            metadata: {},
          },
          {
            eventId: "evt_ok",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:02.000Z",
            type: "click",
            urlPath: "/settings",
            viewportX: 1440,
            viewportY: 900,
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 3 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
    expect(timeline).toHaveLength(3);
    // 0 은 측정 불가이므로 필드를 버린다.
    expect(timeline[0]).not.toHaveProperty("viewportX");
    expect(timeline[0]).not.toHaveProperty("viewportY");
    // 소수는 버리지 않고 반올림해 살린다.
    expect(timeline[1]?.viewportX).toBe(1280);
    expect(timeline[1]?.viewportY).toBe(720);
    expect(timeline[2]?.viewportX).toBe(1440);
    expect(timeline[2]?.viewportY).toBe(900);
  });

  it("rejects events from a disallowed domain", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://evil.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://evil.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("detects and stores friction issues after accepting a batch", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:04.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/#/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "click",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_2",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_3",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:02.000Z",
            type: "click",
            elementSelectorHash: "abc123",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const issues = await store.listIssues(project.projectId);
    expect(issues[0]).toMatchObject({
      issueType: "rage_click",
      relatedUrlPath: "/settings",
    });
  });

  it("prunes old events after storing detected issues when event retention is configured", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({
      store,
      eventRetentionConfig: { eventRetentionDays: 1 },
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-01T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_old_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-30T23:59:57.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_old_2",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-30T23:59:58.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_old_3",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-30T23:59:59.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "abc123",
            metadata: {},
          },
          {
            eventId: "evt_new",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-31T00:00:00.000Z",
            type: "page_view",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect((await store.listEvents(project.projectId)).map((event) => event.eventId)).toEqual(["evt_new"]);
    expect((await store.listIssues(project.projectId)).map((issue) => issue.issueType)).toContain("rage_click");
  });

  it("잘못된 오류 식별자는 배치를 거절하지 않고 필드만 버린다", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/checkout",
        events: [
          {
            eventId: "evt_bad",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "js_error",
            urlPath: "/checkout",
            errorName: "TypeError: 김철수 저장 실패",
            errorSource: "https://app.example.com/a.js?token=abc",
            errorLine: -3,
            metadata: {},
          },
          {
            eventId: "evt_good",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:01.000Z",
            type: "js_error",
            urlPath: "/checkout",
            errorName: "RangeError",
            errorSource: "/assets/pay.js",
            errorLine: 88,
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 2 });
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");

    expect(timeline[0]).not.toHaveProperty("errorName");
    expect(timeline[0]).not.toHaveProperty("errorSource");
    expect(timeline[0]).not.toHaveProperty("errorLine");
    expect(timeline[1]?.errorName).toBe("RangeError");
    expect(timeline[1]?.errorSource).toBe("/assets/pay.js");
    expect(JSON.stringify(timeline)).not.toContain("김철수");
    expect(JSON.stringify(timeline)).not.toContain("token=abc");
  });

  it("선행 이중 슬래시 경로를 버리지 않고 접어서 저장한다", async () => {
    // new URL("https://cdn.example.com//vendor/lib.js").pathname 은 "//vendor/lib.js" 다.
    // 계약이 선행 "//" 를 거절하므로 sanitize 단계에서 접어야 멀쩡한 경로가 살아남는다.
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/checkout",
        events: [
          {
            eventId: "evt_double",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "js_error",
            urlPath: "/checkout",
            errorName: "TypeError",
            errorSource: "//vendor/lib.js",
            errorLine: 7,
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const timeline = await store.getSessionTimeline(project.projectId, "sess_1");

    expect(timeline[0]?.errorSource).toBe("/vendor/lib.js");
  });
});
