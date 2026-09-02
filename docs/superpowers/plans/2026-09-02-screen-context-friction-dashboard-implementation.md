# Screen Context Friction Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이벤트에 안전한 화면 맥락을 붙이고, 관리자 대시보드와 이슈 상세에서 사용자가 어떤 화면에서 무엇을 눌렀는지 한눈에 볼 수 있게 만든다.

**Architecture:** `packages/shared`가 `ScreenContext` 계약과 개인정보 검증을 소유한다. SDK는 클릭 이벤트에서 가벼운 target rect와 viewport를 수집하고, API는 `events.screen_context` JSON 컬럼에 저장한 뒤 관리자 API에서 대표 이벤트를 붙인다. Admin UI는 같은 `ScreenContextPreview` 컴포넌트를 대시보드 첫 화면과 이슈 상세 타임라인에 재사용한다.

**Tech Stack:** TypeScript, Zod, Vite, Vitest, React Testing Library, Fastify, better-sqlite3, SQLite

## Global Constraints

- 모든 이벤트마다 실제 픽셀 스크린샷을 저장하지 않는다.
- 입력값, 사용자 이름, 이메일, 주소, 카드 정보 등 민감 원문을 저장하지 않는다.
- rrweb 수준의 전체 세션 리플레이를 이번 범위에 포함하지 않는다.
- GA식 유입, 캠페인, 방문자 세그먼트 분석을 이번 범위에 포함하지 않는다.
- 화면 맥락은 실제 화면 원본이 아니라 마스킹된 구조와 이벤트 메타데이터로 재구성한다.
- 화면 위에는 복잡한 말풍선을 올리지 않는다. 클릭 위치 표시만 화면 내부에 두고, 설명은 우측 근거 패널 또는 하단 이벤트 흐름에 둔다.
- SDK 번들 크기 예산을 유지한다.
- 이벤트마다 canvas screenshot을 만들지 않는다.
- layout snapshot은 throttle/debounce 대상이며, 최초 MVP에서는 target rect 중심으로 제한한다.
- 수집 실패는 고객 사이트 동작에 영향을 주지 않는다.
- 프로젝트 커뮤니케이션과 사용자-facing product copy는 한국어를 기본으로 한다.
- 기존 미커밋 변경 파일은 이 계획 실행 중 임의로 되돌리지 않는다.

---

## File Structure

- Modify: `packages/shared/src/events.ts`
  - `screenContextSchema`, `ScreenContext` 타입, `TraceEvent.screenContext`, `Issue.representativeEvent` 계약을 추가한다.
- Modify: `packages/shared/src/events.test.ts`
  - 안전한 screen context 허용, 민감 텍스트 거부, layout hint 개수 제한, issue representative event 파싱을 검증한다.
- Modify: `packages/sdk/src/dom.ts`
  - `getScreenContext(element: Element): ScreenContext | undefined`를 추가하고 기존 `getElementMetadata`와 개인정보 규칙을 재사용한다.
- Modify: `packages/sdk/src/dom.test.ts`
  - 클릭 대상 rect, viewport, 민감 input 텍스트 제외, 수집 실패 안전 처리를 검증한다.
- Modify: `packages/sdk/src/collectors.ts`
  - 클릭 이벤트에 `screenContext`를 포함한다.
- Modify: `packages/sdk/src/client.test.ts`
  - collector가 전송하는 click event에 screenContext가 포함되는지 검증한다.
- Modify: `apps/api/src/routes/ingestion.ts`
  - raw ingestion schema와 sanitize path에 `screenContext`를 추가한다.
- Modify: `apps/api/src/routes/ingestion.test.ts`
  - 안전한 screenContext 저장, 과도한 layoutHints 요청 거부를 검증한다.
- Modify: `apps/api/src/db/schema.sqlite.ts`
  - `events.screen_context TEXT` 컬럼을 추가한다.
- Modify: `apps/api/src/store/sqlite-store.ts`
  - SQLite 저장, migration, row mapping, debug view에 screen context를 추가한다.
- Modify: `apps/api/src/store/store-contract.test.ts`
  - MemoryStore와 SQLiteStore가 timeline에서 screenContext를 보존하는지 검증한다.
- Modify: `apps/api/src/routes/admin-proxy.ts`
  - issues/detail 응답에 대표 `representativeEvent`를 붙이는 enrichment를 추가한다.
- Modify: `apps/api/src/routes/admin.test.ts`
  - issues/detail API가 대표 이벤트를 반환하는지 검증한다.
- Modify: `apps/admin/src/api.ts`
  - shared `Issue` 타입 확장을 그대로 사용하고 fetch 함수 타입을 정리한다.
- Create: `apps/admin/src/components/ScreenContextPreview.tsx`
  - 마스킹된 화면 프레임, target rect, layoutHints, fallback 상태를 렌더링한다.
- Create: `apps/admin/src/components/ScreenContextPreview.test.tsx`
  - preview 렌더링, target marker, fallback 상태를 검증한다.
- Modify: `apps/admin/src/components/IssueDashboardOverview.tsx`
  - 첫 화면에 핵심 마찰 문장, 화면 preview, 운영 해석, 근거, 다음 액션을 한 흐름으로 배치한다.
- Modify: `apps/admin/src/components/IssueDashboardOverview.test.tsx`
  - 대표 이벤트 screenContext가 있으면 preview와 운영 해석이 보이는지 검증한다.
- Modify: `apps/admin/src/components/SessionTimeline.tsx`
  - 상세 타임라인에 screen context mini preview와 이벤트 근거를 노출한다.
- Modify: `apps/admin/src/components/SessionTimeline.test.tsx`
  - screenContext가 있는 이벤트와 없는 이벤트를 모두 검증한다.
- Modify: `apps/admin/src/pages/IssueDetailPage.tsx`
  - 대표 화면 필름스트립과 선택 이벤트 context 영역을 구성한다.
- Modify: `apps/admin/src/pages/DashboardPage.test.tsx`
  - dashboard 첫 화면에서 preview 중심 레이아웃이 깨지지 않는지 검증한다.

## Task 1: Shared Screen Context Contract

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/events.test.ts`

**Interfaces:**
- Consumes: `normalizePath`, `redactText`, `isSafeElementRole` from `packages/shared/src/privacy.ts`
- Produces:
  - `export const screenRectSchema: z.ZodObject<...>`
  - `export const screenContextSchema: z.ZodObject<...>`
  - `export type ScreenContext = z.infer<typeof screenContextSchema>`
  - `traceEventSchema.shape.screenContext?: ScreenContext`
  - `issueSchema.shape.representativeEvent?: TraceEvent`

- [ ] **Step 1: Write failing shared schema tests**

Add these tests to `packages/shared/src/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { issueSchema, traceEventSchema } from "./events";

describe("screenContextSchema", () => {
  it("accepts safe target rect and viewport context", () => {
    const parsed = traceEventSchema.parse({
      eventId: "evt_1",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click",
      urlPath: "/settings",
      elementRole: "button",
      elementTextMaskedOrLimited: "저장",
      screenContext: {
        titleMasked: "설정",
        viewport: { width: 1440, height: 900 },
        target: {
          tagName: "button",
          role: "button",
          textMaskedOrLimited: "저장",
          selectorHash: "abc123",
          rect: { x: 620, y: 420, width: 96, height: 40 },
        },
        layoutHints: [
          {
            tagName: "main",
            role: "main",
            textMaskedOrLimited: "설정",
            rect: { x: 240, y: 96, width: 960, height: 640 },
            masked: false,
          },
        ],
      },
    });

    expect(parsed.screenContext?.target?.rect.x).toBe(620);
  });

  it("rejects sensitive text in screen context fields", () => {
    const result = traceEventSchema.safeParse({
      eventId: "evt_2",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click",
      urlPath: "/checkout",
      screenContext: {
        viewport: { width: 390, height: 844 },
        target: {
          tagName: "button",
          role: "button",
          textMaskedOrLimited: "user@example.com",
          rect: { x: 16, y: 720, width: 180, height: 44 },
        },
        layoutHints: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("limits layout hints to keep payloads small", () => {
    const layoutHints = Array.from({ length: 13 }, (_, index) => ({
      tagName: "button",
      role: "button",
      textMaskedOrLimited: `버튼 ${index}`,
      rect: { x: index, y: index, width: 80, height: 32 },
      masked: false,
    }));

    const result = traceEventSchema.safeParse({
      eventId: "evt_3",
      sessionId: "sess_1",
      pageId: "page_1",
      timestamp: "2026-09-02T01:00:00.000Z",
      type: "click",
      urlPath: "/settings",
      screenContext: {
        viewport: { width: 1440, height: 900 },
        layoutHints,
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("issue representative event", () => {
  it("accepts a representative event with screen context", () => {
    const parsed = issueSchema.parse({
      id: "issue_1",
      projectId: "proj_1",
      type: "dead_click",
      severity: "medium",
      status: "open",
      title: "저장 버튼 반응 없음",
      description: "설정 화면에서 저장 버튼 클릭 후 후속 이벤트가 없습니다.",
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:05:00.000Z",
      occurrenceCount: 3,
      affectedSessionCount: 2,
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      representativeEvent: {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.000Z",
        type: "click",
        urlPath: "/settings",
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
    });

    expect(parsed.representativeEvent?.screenContext?.target?.textMaskedOrLimited).toBe("저장");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/shared -- src/events.test.ts`

Expected: FAIL because `screenContext` is stripped or rejected and `representativeEvent` is not part of `issueSchema`.

- [ ] **Step 3: Add schema implementation**

In `packages/shared/src/events.ts`, update imports:

```ts
import { isSafeElementRole, normalizePath, redactText } from "./privacy";
```

Add these schema helpers before `traceEventSchema`:

```ts
const safeScreenTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => redactText(value) === value, {
    message: "screen context text must already be redacted",
  });

const tagNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{0,31}$/);

export const screenRectSchema = z.object({
  x: z.number().finite().min(0).max(10000),
  y: z.number().finite().min(0).max(10000),
  width: z.number().finite().min(0).max(10000),
  height: z.number().finite().min(0).max(10000),
});

const screenElementSchema = z.object({
  tagName: tagNameSchema,
  role: z.string().trim().max(64).refine(isSafeElementRole).optional(),
  textMaskedOrLimited: safeScreenTextSchema.optional(),
  selectorHash: z.string().trim().max(128).optional(),
  rect: screenRectSchema,
});

export const screenContextSchema = z.object({
  titleMasked: safeScreenTextSchema.optional(),
  viewport: z.object({
    width: z.number().int().min(1).max(10000),
    height: z.number().int().min(1).max(10000),
  }),
  target: screenElementSchema.optional(),
  layoutHints: screenElementSchema
    .extend({ masked: z.boolean() })
    .array()
    .max(12)
    .default([]),
});

export type ScreenContext = z.infer<typeof screenContextSchema>;
```

Add to `traceEventSchema`:

```ts
screenContext: screenContextSchema.optional(),
```

Add to `issueSchema` after `exampleSessionIds`:

```ts
representativeEvent: traceEventSchema.optional(),
```

- [ ] **Step 4: Run shared tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/shared -- src/events.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/shared/src/events.ts packages/shared/src/events.test.ts
git commit -m "기능: 화면 맥락 이벤트 계약 추가"
```

## Task 2: SDK Click Screen Context Collection

**Files:**
- Modify: `packages/sdk/src/dom.ts`
- Modify: `packages/sdk/src/dom.test.ts`
- Modify: `packages/sdk/src/collectors.ts`
- Modify: `packages/sdk/src/client.test.ts`

**Interfaces:**
- Consumes: `ScreenContext` from `@trace/shared/events`, `redactText`, `isSensitiveField`, existing `getElementMetadata(element: Element): ElementMetadata`
- Produces:
  - `export function getScreenContext(element: Element): ScreenContext | undefined`
  - click events with `screenContext?: ScreenContext`

- [ ] **Step 1: Write failing DOM collection tests**

Add these tests to `packages/sdk/src/dom.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getScreenContext } from "./dom";

describe("getScreenContext", () => {
  it("captures viewport and target rect for safe clickable elements", () => {
    document.title = "설정";
    window.innerWidth = 1440;
    window.innerHeight = 900;
    const button = document.createElement("button");
    button.textContent = "저장";
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
    document.body.appendChild(button);

    const context = getScreenContext(button);

    expect(context).toEqual({
      titleMasked: "설정",
      viewport: { width: 1440, height: 900 },
      target: {
        tagName: "button",
        role: "button",
        textMaskedOrLimited: "저장",
        selectorHash: expect.any(String),
        rect: { x: 620, y: 420, width: 96, height: 40 },
      },
      layoutHints: [],
    });
  });

  it("omits text for sensitive input targets", () => {
    window.innerWidth = 390;
    window.innerHeight = 844;
    const input = document.createElement("input");
    input.type = "email";
    input.name = "email";
    input.value = "user@example.com";
    input.getBoundingClientRect = vi.fn(() => ({
      x: 16,
      y: 120,
      width: 260,
      height: 44,
      top: 120,
      left: 16,
      right: 276,
      bottom: 164,
      toJSON: () => ({}),
    }));

    const context = getScreenContext(input);

    expect(context?.target).toMatchObject({
      tagName: "input",
      role: "input",
      rect: { x: 16, y: 120, width: 260, height: 44 },
    });
    expect(context?.target).not.toHaveProperty("textMaskedOrLimited");
  });

  it("returns undefined when browser APIs throw", () => {
    const button = document.createElement("button");
    button.getBoundingClientRect = vi.fn(() => {
      throw new Error("layout unavailable");
    });

    expect(getScreenContext(button)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run DOM tests to verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/sdk -- src/dom.test.ts`

Expected: FAIL because `getScreenContext` is not exported.

- [ ] **Step 3: Implement getScreenContext**

In `packages/sdk/src/dom.ts`, add import:

```ts
import type { ScreenContext } from "@trace/shared/events";
```

Add this function:

```ts
function rectFromDomRect(rect: DOMRect | ClientRect): ScreenContext["target"]["rect"] {
  return {
    x: Math.max(0, Math.round(rect.x ?? rect.left)),
    y: Math.max(0, Math.round(rect.y ?? rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

export function getScreenContext(element: Element): ScreenContext | undefined {
  try {
    const rect = element.getBoundingClientRect();
    const metadata = getElementMetadata(element);
    const title = redactText(document.title.trim());
    const text = metadata.elementTextMaskedOrLimited
      ? redactText(metadata.elementTextMaskedOrLimited).slice(0, 120)
      : undefined;

    return {
      ...(title.length > 0 ? { titleMasked: title } : {}),
      viewport: {
        width: Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1)),
        height: Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1)),
      },
      target: {
        tagName: element.tagName.toLowerCase(),
        ...(metadata.elementRole ? { role: metadata.elementRole } : {}),
        ...(text && text.length > 0 ? { textMaskedOrLimited: text } : {}),
        ...(metadata.elementSelectorHash ? { selectorHash: metadata.elementSelectorHash } : {}),
        rect: rectFromDomRect(rect),
      },
      layoutHints: [],
    };
  } catch {
    return undefined;
  }
}
```

If TypeScript rejects `ScreenContext["target"]["rect"]` because `target` is optional, define:

```ts
type ScreenRect = NonNullable<ScreenContext["target"]>["rect"];
```

and use `ScreenRect` as the return type.

- [ ] **Step 4: Wire click collector**

In `packages/sdk/src/collectors.ts`, update import:

```ts
import { getElementMetadata, getScreenContext } from "./dom";
```

Inside the click listener, compute context after metadata:

```ts
const screenContext = getScreenContext(target);
```

Add to the click event object:

```ts
...(screenContext ? { screenContext } : {}),
```

- [ ] **Step 5: Add client integration assertion**

In `packages/sdk/src/client.test.ts`, extend the existing collector click test or add this test:

```ts
it("sends screen context for click collector events", async () => {
  const sentBatches: unknown[] = [];
  const client = createTraceClient({
    projectId: "proj_1",
    endpoint: "https://collector.example.com/ingest",
    transport: {
      send: async (batch) => {
        sentBatches.push(batch);
      },
    },
    flushIntervalMs: 10,
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

  button.click();
  await client.flush();

  const batch = sentBatches[0] as { events: Array<{ type: string; screenContext?: unknown }> };
  expect(batch.events.find((event) => event.type === "click")?.screenContext).toMatchObject({
    viewport: { width: 1440, height: 900 },
    target: {
      tagName: "button",
      role: "button",
      textMaskedOrLimited: "저장",
      rect: { x: 620, y: 420, width: 96, height: 40 },
    },
  });
});
```

Use the existing client factory and transport helper names in the file if they differ from this snippet. Keep the assertion shape exactly the same.

- [ ] **Step 6: Run SDK tests and bundle budget**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/sdk -- src/dom.test.ts src/client.test.ts src/bundle-size.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/sdk/src/dom.ts packages/sdk/src/dom.test.ts packages/sdk/src/collectors.ts packages/sdk/src/client.test.ts
git commit -m "기능: SDK 클릭 화면 맥락 수집"
```

## Task 3: API Ingestion and Store Persistence

**Files:**
- Modify: `apps/api/src/routes/ingestion.ts`
- Modify: `apps/api/src/routes/ingestion.test.ts`
- Modify: `apps/api/src/db/schema.sqlite.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Modify: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: `screenContextSchema`, `ScreenContext`, `TraceEvent.screenContext`
- Produces:
  - `events.screen_context TEXT` SQLite column storing `JSON.stringify(event.screenContext)`
  - `toEvent(row).screenContext?: ScreenContext`
  - ingestion accepts safe `screenContext` and rejects invalid context with 400

- [ ] **Step 1: Write store contract test**

Add this test to the shared store contract suite in `apps/api/src/store/store-contract.test.ts`:

```ts
it("preserves screen context in session timeline events", async () => {
  const store = createStore();
  await store.saveBatch({
    projectId: "proj_1",
    anon: { id: "anon_1" },
    session: { id: "sess_1", startedAt: "2026-09-02T01:00:00.000Z" },
    sentAt: "2026-09-02T01:00:01.000Z",
    sdkVersion: "0.1.0",
    url: "https://example.com/settings",
    events: [
      {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.000Z",
        type: "click",
        urlPath: "/settings",
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
  });

  const timeline = await store.getSessionTimeline("proj_1", "sess_1");

  expect(timeline[0].screenContext).toMatchObject({
    viewport: { width: 1440, height: 900 },
    target: {
      tagName: "button",
      textMaskedOrLimited: "저장",
      rect: { x: 620, y: 420, width: 96, height: 40 },
    },
  });
});
```

- [ ] **Step 2: Write ingestion tests**

Add these tests to `apps/api/src/routes/ingestion.test.ts`:

```ts
it("stores safe screen context from ingested events", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/ingest",
    payload: {
      projectId: "proj_1",
      anon: { id: "anon_1" },
      session: { id: "sess_1", startedAt: "2026-09-02T01:00:00.000Z" },
      sentAt: "2026-09-02T01:00:01.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "click",
          urlPath: "/settings",
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
  const timeline = await store.getSessionTimeline("proj_1", "sess_1");
  expect(timeline[0].screenContext?.target?.textMaskedOrLimited).toBe("저장");
});

it("rejects invalid screen context payloads", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/ingest",
    payload: {
      projectId: "proj_1",
      anon: { id: "anon_1" },
      session: { id: "sess_1", startedAt: "2026-09-02T01:00:00.000Z" },
      sentAt: "2026-09-02T01:00:01.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "click",
          urlPath: "/settings",
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

  expect(response.statusCode).toBe(400);
});
```

Adjust only variable names such as `app` and `store` to match the existing test setup in the file.

- [ ] **Step 3: Run API tests to verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts src/routes/ingestion.test.ts`

Expected: FAIL because SQLite rows do not persist `screen_context` and ingestion raw schema does not accept `screenContext`.

- [ ] **Step 4: Add ingestion schema field**

In `apps/api/src/routes/ingestion.ts`, import:

```ts
import { screenContextSchema } from "@trace/shared/events";
```

Add to `rawTraceEventSchema`:

```ts
screenContext: screenContextSchema.optional(),
```

Add to `sanitizeEvent` return object:

```ts
...(event.screenContext ? { screenContext: event.screenContext } : {}),
```

The existing `eventBatchSchema.parse` call remains the final validation gate.

- [ ] **Step 5: Add SQLite column and migration**

In `apps/api/src/db/schema.sqlite.ts`, add column to `CREATE TABLE events`:

```sql
screen_context TEXT,
```

In `apps/api/src/store/sqlite-store.ts`, update `migrate()`:

```ts
if (!columns.has("screen_context")) {
  this.db.exec("ALTER TABLE events ADD COLUMN screen_context TEXT");
}
```

Use the same `columns` set or helper already used by the `received_at` migration.

- [ ] **Step 6: Persist and hydrate screen context**

In the event insert statement, add `screen_context` after `metadata` or before it, keeping values order exact:

```ts
JSON.stringify(event.screenContext ?? null),
```

In `toEvent(row)`, parse the column safely:

```ts
const screenContext = row.screen_context
  ? screenContextSchema.safeParse(JSON.parse(row.screen_context))
  : undefined;
```

Add to the returned event:

```ts
...(screenContext?.success ? { screenContext: screenContext.data } : {}),
```

When `row.screen_context` is `null`, `""`, or invalid JSON, omit `screenContext` from the returned event.

- [ ] **Step 7: Update debug view**

In `createDebugViews()`, include:

```sql
screen_context,
```

in `events_debug` so local DB inspection can see context JSON.

- [ ] **Step 8: Run API persistence tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts src/routes/ingestion.test.ts src/store/sqlite-store.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add apps/api/src/routes/ingestion.ts apps/api/src/routes/ingestion.test.ts apps/api/src/db/schema.sqlite.ts apps/api/src/store/sqlite-store.ts apps/api/src/store/store-contract.test.ts
git commit -m "기능: 화면 맥락 저장 파이프라인 추가"
```

## Task 4: Admin API Representative Event Enrichment

**Files:**
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Modify: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `Issue.exampleSessionIds`, `Issue.relatedUrlPath`, `store.getSessionTimeline(projectId, sessionId)`
- Produces:
  - Issues API returns `Issue[]` where each issue may include `representativeEvent`
  - Issue detail API returns `Issue` with `representativeEvent` when matching evidence exists

- [ ] **Step 1: Write admin API enrichment tests**

Add this test to `apps/api/src/routes/admin.test.ts` near existing issue list/detail tests:

```ts
it("adds representative screen context events to issue responses", async () => {
  await store.saveBatch({
    projectId: "proj_1",
    anon: { id: "anon_1" },
    session: { id: "sess_1", startedAt: "2026-09-02T01:00:00.000Z" },
    sentAt: "2026-09-02T01:00:01.000Z",
    sdkVersion: "0.1.0",
    url: "https://example.com/settings",
    events: [
      {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-09-02T01:00:00.000Z",
        type: "click",
        urlPath: "/settings",
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
  });

  await store.saveIssues([
    {
      id: "issue_1",
      projectId: "proj_1",
      type: "dead_click",
      severity: "medium",
      status: "open",
      title: "저장 버튼 반응 없음",
      description: "설정 화면에서 저장 버튼 클릭 후 후속 이벤트가 없습니다.",
      firstSeenAt: "2026-09-02T01:00:00.000Z",
      lastSeenAt: "2026-09-02T01:00:00.000Z",
      occurrenceCount: 1,
      affectedSessionCount: 1,
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
    },
  ]);

  const response = await app.inject({
    method: "GET",
    url: "/admin/api/projects/proj_1/issues",
  });

  expect(response.statusCode).toBe(200);
  const issues = response.json();
  expect(issues[0].representativeEvent).toMatchObject({
    eventId: "evt_1",
    type: "click",
    screenContext: {
      target: {
        textMaskedOrLimited: "저장",
      },
    },
  });
});
```

If the admin tests require an authenticated request helper, use the helper already present in the file and keep the payload assertions unchanged.

- [ ] **Step 2: Run admin API test to verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts`

Expected: FAIL because `representativeEvent` is not enriched.

- [ ] **Step 3: Implement enrichment helper**

In `apps/api/src/routes/admin-proxy.ts`, add:

```ts
async function attachRepresentativeEvents(projectId: string, issues: Issue[]): Promise<Issue[]> {
  return Promise.all(
    issues.map(async (issue) => ({
      ...issue,
      representativeEvent: await findRepresentativeEvent(projectId, issue),
    })),
  );
}

async function findRepresentativeEvent(projectId: string, issue: Issue): Promise<TraceEvent | undefined> {
  for (const sessionId of issue.exampleSessionIds.slice(0, 3)) {
    const timeline = await store.getSessionTimeline(projectId, sessionId);
    const matchingEvent = timeline.find((event) => {
      const samePath = issue.relatedUrlPath ? event.urlPath === issue.relatedUrlPath : true;
      return samePath && Boolean(event.screenContext);
    });

    if (matchingEvent) {
      return matchingEvent;
    }
  }

  return undefined;
}
```

Place the helper inside the route registration closure if it needs direct access to `store`. Import `Issue` and `TraceEvent` from `@trace/shared/events`.

- [ ] **Step 4: Use enrichment in issues and detail endpoints**

In `GET /admin/api/projects/:projectId/issues`, wrap the returned list:

```ts
const issues = await store.listIssues(projectId);
return attachRepresentativeEvents(projectId, issues);
```

In `GET /admin/api/issues/:issueId`, after loading the issue:

```ts
const [enrichedIssue] = await attachRepresentativeEvents(issue.projectId, [issue]);
return enrichedIssue;
```

- [ ] **Step 5: Run admin API tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/api/src/routes/admin-proxy.ts apps/api/src/routes/admin.test.ts
git commit -m "기능: 이슈 대표 화면 맥락 API 추가"
```

## Task 5: Admin Screen Context Preview Component

**Files:**
- Create: `apps/admin/src/components/ScreenContextPreview.tsx`
- Create: `apps/admin/src/components/ScreenContextPreview.test.tsx`

**Interfaces:**
- Consumes: `ScreenContext` and `TraceEvent` from `@trace/shared/events`
- Produces:
  - `export function ScreenContextPreview(props: ScreenContextPreviewProps): JSX.Element`
  - `export interface ScreenContextPreviewProps { context?: ScreenContext; event?: TraceEvent; compact?: boolean; }`

- [ ] **Step 1: Write component tests**

Create `apps/admin/src/components/ScreenContextPreview.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenContextPreview } from "./ScreenContextPreview";

describe("ScreenContextPreview", () => {
  it("renders a masked screen preview with target evidence", () => {
    render(
      <ScreenContextPreview
        context={{
          titleMasked: "설정",
          viewport: { width: 1440, height: 900 },
          target: {
            tagName: "button",
            role: "button",
            textMaskedOrLimited: "저장",
            rect: { x: 620, y: 420, width: 96, height: 40 },
          },
          layoutHints: [
            {
              tagName: "main",
              role: "main",
              textMaskedOrLimited: "설정 영역",
              rect: { x: 240, y: 96, width: 960, height: 640 },
              masked: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("설정")).toBeInTheDocument();
    expect(screen.getByText("저장")).toBeInTheDocument();
    expect(screen.getByLabelText("클릭 위치")).toBeInTheDocument();
  });

  it("renders fallback when screen context is missing", () => {
    render(<ScreenContextPreview />);

    expect(screen.getByText("화면 맥락 없음")).toBeInTheDocument();
    expect(screen.getByText("이 이벤트에는 안전한 화면 재구성 정보가 없습니다.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component test to verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/components/ScreenContextPreview.test.tsx`

Expected: FAIL because `ScreenContextPreview` does not exist.

- [ ] **Step 3: Implement component**

Create `apps/admin/src/components/ScreenContextPreview.tsx`:

```tsx
import type { ScreenContext, TraceEvent } from "@trace/shared/events";

export interface ScreenContextPreviewProps {
  context?: ScreenContext;
  event?: TraceEvent;
  compact?: boolean;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function rectStyle(context: ScreenContext, rect: { x: number; y: number; width: number; height: number }) {
  const { width, height } = context.viewport;
  return {
    left: `${clampPercent((rect.x / width) * 100)}%`,
    top: `${clampPercent((rect.y / height) * 100)}%`,
    width: `${clampPercent((rect.width / width) * 100)}%`,
    height: `${clampPercent((rect.height / height) * 100)}%`,
  };
}

export function ScreenContextPreview({ context, event, compact = false }: ScreenContextPreviewProps) {
  if (!context) {
    return (
      <section className="screen-preview screen-preview--empty" aria-label="화면 맥락 미리보기">
        <strong>화면 맥락 없음</strong>
        <span>이 이벤트에는 안전한 화면 재구성 정보가 없습니다.</span>
      </section>
    );
  }

  const targetLabel =
    context.target?.textMaskedOrLimited ?? context.target?.role ?? context.target?.tagName ?? event?.type ?? "이벤트";

  return (
    <section className={`screen-preview${compact ? " screen-preview--compact" : ""}`} aria-label="화면 맥락 미리보기">
      <header className="screen-preview__bar">
        <span className="screen-preview__dot" />
        <span className="screen-preview__dot" />
        <span className="screen-preview__dot" />
        <strong>{context.titleMasked ?? event?.urlPath ?? "사용자 화면"}</strong>
      </header>
      <div className="screen-preview__canvas" style={{ aspectRatio: `${context.viewport.width} / ${context.viewport.height}` }}>
        {context.layoutHints.map((hint, index) => (
          <div
            className={`screen-preview__hint${hint.masked ? " screen-preview__hint--masked" : ""}`}
            key={`${hint.tagName}-${index}-${hint.rect.x}-${hint.rect.y}`}
            style={rectStyle(context, hint.rect)}
          >
            {!hint.masked && hint.textMaskedOrLimited ? <span>{hint.textMaskedOrLimited}</span> : null}
          </div>
        ))}
        {context.target ? (
          <div className="screen-preview__target" style={rectStyle(context, context.target.rect)}>
            <span>{targetLabel}</span>
            <i aria-label="클릭 위치" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add styles near existing admin component styles**

Use the CSS file already imported by `DashboardPage.tsx` or `IssueDashboardOverview.tsx`. Add:

```css
.screen-preview {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: #f8fafc;
  overflow: hidden;
}

.screen-preview--empty {
  display: grid;
  gap: 6px;
  padding: 20px;
  color: var(--text-muted);
}

.screen-preview__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: #ffffff;
  color: var(--text-strong);
}

.screen-preview__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #cbd5e1;
}

.screen-preview__canvas {
  position: relative;
  min-height: 180px;
  background:
    linear-gradient(90deg, rgba(148, 163, 184, 0.12) 1px, transparent 1px),
    linear-gradient(180deg, rgba(148, 163, 184, 0.12) 1px, transparent 1px),
    #f8fafc;
  background-size: 32px 32px;
}

.screen-preview__hint,
.screen-preview__target {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  min-height: 14px;
  border-radius: 6px;
  overflow: hidden;
}

.screen-preview__hint {
  border: 1px solid rgba(100, 116, 139, 0.28);
  background: rgba(255, 255, 255, 0.74);
  color: var(--text-muted);
  font-size: 11px;
}

.screen-preview__hint--masked {
  background: repeating-linear-gradient(135deg, #e2e8f0, #e2e8f0 6px, #f8fafc 6px, #f8fafc 12px);
}

.screen-preview__target {
  border: 2px solid #2563eb;
  background: rgba(37, 99, 235, 0.10);
  color: #1e3a8a;
  font-size: 12px;
  font-weight: 700;
}

.screen-preview__target i {
  position: absolute;
  right: -7px;
  top: -7px;
  width: 14px;
  height: 14px;
  border: 3px solid #ef4444;
  border-radius: 999px;
  background: #ffffff;
}
```

If the CSS variable names differ, use the closest existing variables in the same stylesheet and keep the color roles unchanged.

- [ ] **Step 5: Run admin component test**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/components/ScreenContextPreview.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/admin/src/components/ScreenContextPreview.tsx apps/admin/src/components/ScreenContextPreview.test.tsx apps/admin/src
git commit -m "기능: 관리자 화면 맥락 미리보기 추가"
```

## Task 6: Dashboard and Issue Detail UX Integration

**Files:**
- Modify: `apps/admin/src/components/IssueDashboardOverview.tsx`
- Modify: `apps/admin/src/components/IssueDashboardOverview.test.tsx`
- Modify: `apps/admin/src/components/SessionTimeline.tsx`
- Modify: `apps/admin/src/components/SessionTimeline.test.tsx`
- Modify: `apps/admin/src/pages/IssueDetailPage.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `ScreenContextPreview`, `Issue.representativeEvent`, `SessionTimelineEvent.screenContext`
- Produces:
  - Dashboard first screen shows key friction sentence, preview, operator interpretation, evidence, and next action
  - Issue detail shows representative screen context and timeline previews without requiring an extra popup

- [ ] **Step 1: Write overview test**

Update `apps/admin/src/components/IssueDashboardOverview.test.tsx` with a case that renders one issue containing `representativeEvent`:

```tsx
it("shows a screen-first friction summary for the top issue", () => {
  render(
    <IssueDashboardOverview
      issues={[
        {
          id: "issue_1",
          projectId: "proj_1",
          type: "dead_click",
          severity: "medium",
          status: "open",
          title: "저장 버튼 반응 없음",
          description: "설정 화면에서 저장 버튼 클릭 후 후속 이벤트가 없습니다.",
          firstSeenAt: "2026-09-02T01:00:00.000Z",
          lastSeenAt: "2026-09-02T01:05:00.000Z",
          occurrenceCount: 3,
          affectedSessionCount: 2,
          relatedUrlPath: "/settings",
          exampleSessionIds: ["sess_1"],
          representativeEvent: {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
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
        },
      ]}
    />,
  );

  expect(screen.getByText("가장 먼저 볼 사용자 막힘")).toBeInTheDocument();
  expect(screen.getByText("설정 화면에서 저장 버튼 반응 없음")).toBeInTheDocument();
  expect(screen.getByLabelText("화면 맥락 미리보기")).toBeInTheDocument();
  expect(screen.getByText("다음 액션")).toBeInTheDocument();
});
```

- [ ] **Step 2: Write timeline test**

Update `apps/admin/src/components/SessionTimeline.test.tsx`:

```tsx
it("renders screen context evidence inside the timeline", () => {
  render(
    <SessionTimeline
      events={[
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-09-02T01:00:00.000Z",
          type: "click",
          urlPath: "/settings",
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
      ]}
    />,
  );

  expect(screen.getByText("저장")).toBeInTheDocument();
  expect(screen.getByLabelText("화면 맥락 미리보기")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run admin tests to verify failure**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/components/IssueDashboardOverview.test.tsx src/components/SessionTimeline.test.tsx`

Expected: FAIL because the new labels and previews are not rendered.

- [ ] **Step 4: Update IssueDashboardOverview layout**

In `IssueDashboardOverview.tsx`, derive the top issue:

```tsx
const topIssue = issues[0];
const representativeEvent = topIssue?.representativeEvent;
const targetText = representativeEvent?.screenContext?.target?.textMaskedOrLimited;
const pageLabel = topIssue?.relatedUrlPath ?? representativeEvent?.urlPath ?? "알 수 없는 화면";
```

Render a first section before existing charts:

```tsx
{topIssue ? (
  <section className="friction-hero" aria-label="가장 먼저 볼 사용자 막힘">
    <div className="friction-hero__preview">
      <ScreenContextPreview context={representativeEvent?.screenContext} event={representativeEvent} />
    </div>
    <div className="friction-hero__analysis">
      <p className="friction-hero__eyebrow">가장 먼저 볼 사용자 막힘</p>
      <h2>{pageLabel} 화면에서 {targetText ? `${targetText} ` : ""}{topIssue.title}</h2>
      <dl>
        <div>
          <dt>운영 해석</dt>
          <dd>{topIssue.description}</dd>
        </div>
        <div>
          <dt>근거</dt>
          <dd>{topIssue.occurrenceCount}회 발생, {topIssue.affectedSessionCount}개 세션 영향</dd>
        </div>
        <div>
          <dt>다음 액션</dt>
          <dd>해당 화면의 클릭 후 반응, 성공 피드백, 오류 노출 상태를 우선 점검합니다.</dd>
        </div>
      </dl>
    </div>
  </section>
) : null}
```

Import `ScreenContextPreview` at the top. Keep existing issue distribution and recent issue content below this section.

- [ ] **Step 5: Update SessionTimeline**

In `SessionTimeline.tsx`, import `ScreenContextPreview` and render it for events with context:

```tsx
{event.screenContext ? (
  <ScreenContextPreview context={event.screenContext} event={event} compact />
) : null}
```

Place this directly under the event summary row so issue detail does not need an extra modal to see the screen.

- [ ] **Step 6: Update IssueDetailPage**

In `IssueDetailPage.tsx`, render the issue's representative context near the title area:

```tsx
{issue.representativeEvent?.screenContext ? (
  <section className="issue-detail__screen-context" aria-label="대표 화면 맥락">
    <h3>대표 화면 맥락</h3>
    <ScreenContextPreview
      context={issue.representativeEvent.screenContext}
      event={issue.representativeEvent}
    />
  </section>
) : null}
```

Import `ScreenContextPreview`. Keep the existing `SessionTimeline` below this section.

- [ ] **Step 7: Add layout styles**

Use the same admin stylesheet used in Task 5 and add:

```css
.friction-hero {
  display: grid;
  grid-template-columns: minmax(320px, 1.2fr) minmax(280px, 0.8fr);
  gap: 20px;
  align-items: stretch;
  margin-bottom: 24px;
}

.friction-hero__analysis {
  display: grid;
  gap: 14px;
  align-content: start;
}

.friction-hero__eyebrow {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 700;
}

.friction-hero__analysis h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 22px;
  line-height: 1.35;
}

.friction-hero__analysis dl {
  display: grid;
  gap: 12px;
  margin: 0;
}

.friction-hero__analysis dt {
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 700;
}

.friction-hero__analysis dd {
  margin: 4px 0 0;
  color: var(--text-muted);
  line-height: 1.55;
}

.issue-detail__screen-context {
  display: grid;
  gap: 12px;
  margin: 16px 0 20px;
}

@media (max-width: 900px) {
  .friction-hero {
    grid-template-columns: 1fr;
  }
}
```

If the existing UI uses different text CSS variables, reuse the existing variable names and preserve the grid behavior.

- [ ] **Step 8: Run admin tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/components/ScreenContextPreview.test.tsx src/components/IssueDashboardOverview.test.tsx src/components/SessionTimeline.test.tsx src/pages/DashboardPage.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add apps/admin/src/components/IssueDashboardOverview.tsx apps/admin/src/components/IssueDashboardOverview.test.tsx apps/admin/src/components/SessionTimeline.tsx apps/admin/src/components/SessionTimeline.test.tsx apps/admin/src/pages/IssueDetailPage.tsx apps/admin/src/pages/DashboardPage.test.tsx apps/admin/src
git commit -m "기능: 화면 중심 마찰 대시보드 연결"
```

## Task 7: End-to-End Verification and Demo Check

**Files:**
- Modify only if a verification failure points to a concrete bug introduced by Tasks 1-6.

**Interfaces:**
- Consumes: all previous tasks
- Produces:
  - Typecheck pass
  - Full test pass
  - SDK bundle contains screen context collection
  - Admin dashboard renders without overlap in desktop and mobile smoke checks

- [ ] **Step 1: Run full tests**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Build affected packages**

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build --workspace @trace/shared`

Expected: PASS.

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build --workspace @trace/sdk`

Expected: PASS.

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build --workspace @trace/api`

Expected: PASS.

Run: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build --workspace @trace/admin`

Expected: PASS.

- [ ] **Step 4: Run local smoke with API and admin**

Start API:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH TRACE_DB_PATH=/private/tmp/trace-screen-context.db GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback SESSION_SECRET=0123456789abcdef0123456789abcdef ADMIN_APP_ORIGIN=http://localhost:5173 ADMIN_ALLOWED_EMAILS=admin@example.com COOKIE_SECURE=false npm run dev:api
```

Start admin:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run dev:admin
```

Use the existing local admin auth bypass or seeded admin session helper documented in the admin tests. Visit `http://localhost:5173`, select a project with seeded issues, and verify:

- Dashboard first screen shows a screen preview before charts.
- The click marker is inside the preview, not as a floating black box.
- The right side shows 운영 해석, 근거, 다음 액션.
- Issue detail shows 대표 화면 맥락 and timeline previews without opening a second popup.
- Mobile width 390px stacks the preview and analysis in one column.

- [ ] **Step 5: Inspect SDK bundle behavior**

Run the package build from Step 3, then inspect the built SDK:

```bash
rg "getScreenContext|screenContext|layoutHints" packages/sdk/dist packages/sdk/src
```

Expected: `packages/sdk/dist/trace.js` and source files contain `screenContext`.

- [ ] **Step 6: Run git cleanliness check**

Run: `git status --short`

Expected: only intentional files from this feature are modified. Existing unrelated user changes remain untouched.

- [ ] **Step 7: Commit verification fixes if any were made**

If Step 1-6 required code changes, commit only those files:

```bash
git add <exact files changed during Task 7>
git commit -m "수정: 화면 맥락 대시보드 검증 이슈 정리"
```

If Step 1-6 required no code changes, do not create an empty commit.

## Self-Review

- Spec coverage: Task 1 covers the shared `ScreenContext` contract and privacy limits. Task 2 covers MVP target rect collection without pixel screenshots. Task 3 covers ingestion and SQLite `screen_context` storage. Task 4 covers representative screen context in admin APIs. Task 5 covers reusable masked preview UI. Task 6 covers dashboard first screen and issue detail visibility. Task 7 covers tests, typecheck, builds, SDK bundle inspection, and responsive smoke checks.
- Placeholder scan: 금지 표현이 실행 지시로 남아 있지 않고, 각 code task에는 구체적인 files, snippets, commands, expected outcomes가 포함되어 있다.
- Type consistency: `ScreenContext`, `screenContextSchema`, `TraceEvent.screenContext`, `Issue.representativeEvent`, and `ScreenContextPreview` names are introduced before they are consumed by later tasks.
