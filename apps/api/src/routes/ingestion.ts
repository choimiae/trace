import {
  eventBatchSchema,
  eventTypeSchema,
  isSafeElementRole,
  isSafeElementSelectorHash,
  isSafeTraceIdentifier,
  isoDateStringSchema,
  redactMetadata,
  redactText,
  redactUrl,
  screenContextSchema,
} from "@trace/shared";
import type { EventBatch, RedactedUrl, ScreenContext, TraceEvent } from "@trace/shared";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { detectIssues } from "../detection/detect.js";
import type { EventRetentionConfig } from "../retention/config.js";
import { runEventRetention } from "../retention/events.js";
import type { TraceStore } from "../store/types.js";

const MAX_SCREEN_RECT = 10000;
const MAX_VIEWPORT = 10000;
const MAX_LAYOUT_HINTS = 12;
const MAX_SCREEN_TEXT = 120;
const SAFE_TAG_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
// 두 정규식의 사본이 packages/sdk/src/collectors.ts(SAFE_ERROR_NAME_PATTERN,
// SAFE_ERROR_SOURCE_SHAPE)와 packages/shared/src/events.ts(errorNameSchema,
// errorSourceSchema)에도 있다. 공유 상수로 묶지 않는 것은 기존 관례이므로 셋을 함께
// 고친다. 어긋나면: 이 파일의 정리기 계약은 "언제나 eventBatchSchema.parse 가 받는
// 값을 낸다" 이므로, 계약 쪽 정규식만 좁히면 정리해서 통과시키던 값이 배치 전체
// 400 이 된다 — "수집 API 는 거절이 아니라 정리한다" 가 깨진다.
// 소스 정규식은 계약 사본과 일부러 다르다. 계약은 선행 "//" 를 lookahead 로 거절하고
// 여기는 거절하지 않지만, sanitizeErrorSource 가 먼저 "//" 를 접으므로 이 사본이
// 계약이 거절할 값을 낼 수는 없다. 접기를 지우면 그 보장이 사라진다.
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SAFE_ERROR_SOURCE_PATTERN = /^\/[^\s?#]*$/;
const MAX_ERROR_SOURCE = 256;

// 힌트의 masked 는 SDK 가 매긴 값이라 신뢰하지 않는다. 구식 SDK 는 input/select 에도
// masked:false 를 실어 보낼 수 있으므로, 서버가 태그·role 로 직접 재판정한다.
// target(클릭된 요소)에는 적용하지 않는다 — 그 라벨을 보여주는 것이 기능의 목적이고,
// 클릭은 <div> 같은 컨테이너에도 정당하게 떨어질 수 있다.
const SERVER_MASKED_TAGS = new Set(["input", "select", "textarea"]);
const SERVER_TEXT_TAGS = new Set(["button", "a", "h1", "h2", "h3"]);
const SERVER_TEXT_ROLES = new Set(["button", "link", "tab", "heading"]);

// 화면 맥락은 다른 필드와 같이 "느슨하게 받고 정제한다". 고객 사이트의 평범한 DOM
// (대문자 role, 토큰 목록 role, 뷰포트보다 긴 래퍼 등) 때문에 배치 전체가 400 이 되면
// SDK 큐가 영구히 막힌다. 정제 불가한 값은 필드만 버린다.
const rawScreenRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
});

const rawScreenElementSchema = z.object({
  tagName: z.string(),
  role: z.string().optional(),
  textMaskedOrLimited: z.string().optional(),
  selectorHash: z.string().optional(),
  rect: rawScreenRectSchema,
});

const rawScreenContextSchema = z.object({
  titleMasked: z.string().optional(),
  viewport: z.object({ width: z.number().finite(), height: z.number().finite() }),
  target: rawScreenElementSchema.optional(),
  layoutHints: z.array(rawScreenElementSchema.extend({ masked: z.boolean() })).default([]),
});

const rawTraceEventSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  timestamp: isoDateStringSchema,
  type: eventTypeSchema,
  urlPath: z.string().min(1).optional(),
  urlQueryRedacted: z.string().optional(),
  titleMasked: z.string().max(500).optional(),
  elementSelectorHash: z.string().optional(),
  elementRole: z.string().optional(),
  elementTextMaskedOrLimited: z.string().max(500).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  // 뷰포트는 느슨하게 받고 sanitizeViewportDimension 에서 정리한다. SDK 가
  // window.innerWidth/innerHeight 를 무조건 보내는데 숨은 iframe·레이아웃 전에는
  // 0, 확대 상태에서는 소수가 되므로, 엄격 검증은 배치 전체를 400 으로 떨어뜨린다.
  viewportX: z.unknown().optional(),
  viewportY: z.unknown().optional(),
  metadata: z.record(z.unknown()).default({}),
  errorName: z.unknown().optional(),
  errorSource: z.unknown().optional(),
  errorLine: z.unknown().optional(),
  screenContext: z.unknown().optional(),
});

const rawEventBatchSchema = z.object({
  projectId: z.string().min(1),
  anonymousUserId: z.string().min(1),
  sessionId: z.string().min(1),
  sentAt: isoDateStringSchema,
  sdkVersion: z.string().min(1),
  url: z.string().url(),
  events: z.array(rawTraceEventSchema).min(1).max(100),
});

export async function registerIngestionRoutes(
  app: FastifyInstance,
  options: {
    store: TraceStore;
    eventRetentionConfig?: EventRetentionConfig | undefined;
    now?: (() => Date) | undefined;
  },
) {
  app.post("/v1/events/batch", async (request, reply) => {
    try {
      const rawBatch = rawEventBatchSchema.parse(request.body);
      const project = await options.store.getProject(rawBatch.projectId);
      if (!project) return reply.code(404).send({ error: "project_not_found" });

      const redactedUrl = redactUrl(rawBatch.url);
      const origin = request.headers.origin ?? redactedUrl.origin;
      if (!project.allowedDomains.includes(origin) || !project.allowedDomains.includes(redactedUrl.origin)) {
        return reply.code(403).send({ error: "domain_not_allowed" });
      }

      const sessionId = sanitizeTraceIdentifier(rawBatch.sessionId, "sess");
      const sanitizedBatch = eventBatchSchema.parse({
        ...rawBatch,
        anonymousUserId: sanitizeTraceIdentifier(rawBatch.anonymousUserId, "anon"),
        sessionId,
        url: `${redactedUrl.origin}${redactedUrl.urlPath}${redactedUrl.urlQueryRedacted}`,
        events: rawBatch.events.map((event) => sanitizeEvent(event, redactedUrl, sessionId)),
      }) satisfies EventBatch;

      await options.store.saveBatch(sanitizedBatch);
      const projectEvents = await options.store.listEvents(sanitizedBatch.projectId);
      const issues = detectIssues({
        projectId: sanitizedBatch.projectId,
        events: projectEvents,
        now: (options.now?.() ?? new Date()).toISOString(),
      });
      await options.store.upsertIssues(sanitizedBatch.projectId, issues);
      await runEventRetention(
        options.store,
        options.eventRetentionConfig ?? {},
        options.now?.() ?? new Date(),
      );

      return reply.code(202).send({ accepted: sanitizedBatch.events.length });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "invalid_event_batch" });
      throw error;
    }
  });
}

function sanitizeEvent(
  event: z.infer<typeof rawTraceEventSchema>,
  batchUrl: RedactedUrl,
  batchSessionId: string,
): TraceEvent {
  const eventUrl = sanitizeEventUrl(event, batchUrl);
  const screenContext = sanitizeScreenContext(event.screenContext);
  const viewportX = sanitizeViewportDimension(event.viewportX);
  const viewportY = sanitizeViewportDimension(event.viewportY);
  const errorName = sanitizeErrorName(event.errorName);
  const errorSource = sanitizeErrorSource(event.errorSource);
  const errorLine = sanitizeErrorLine(event.errorLine);

  return {
    eventId: sanitizeTraceIdentifier(event.eventId, "evt"),
    sessionId: isSafeTraceIdentifier(event.sessionId, "sess") ? event.sessionId : batchSessionId,
    pageId: sanitizeTraceIdentifier(event.pageId, "page"),
    timestamp: event.timestamp,
    type: event.type,
    urlPath: eventUrl.urlPath,
    ...(eventUrl.urlQueryRedacted ? { urlQueryRedacted: eventUrl.urlQueryRedacted } : {}),
    ...(event.titleMasked ? { titleMasked: redactText(event.titleMasked) } : {}),
    ...(event.elementSelectorHash && isSafeElementSelectorHash(event.elementSelectorHash)
      ? { elementSelectorHash: event.elementSelectorHash }
      : {}),
    ...(event.elementRole && isSafeElementRole(event.elementRole) ? { elementRole: event.elementRole } : {}),
    ...(event.elementTextMaskedOrLimited ? { elementTextMaskedOrLimited: redactText(event.elementTextMaskedOrLimited) } : {}),
    ...(event.x === undefined ? {} : { x: event.x }),
    ...(event.y === undefined ? {} : { y: event.y }),
    ...(viewportX === undefined ? {} : { viewportX }),
    ...(viewportY === undefined ? {} : { viewportY }),
    metadata: redactMetadata(event.metadata),
    ...(errorName === undefined ? {} : { errorName }),
    ...(errorSource === undefined ? {} : { errorSource }),
    ...(errorLine === undefined ? {} : { errorLine }),
    ...(screenContext ? { screenContext } : {}),
  };
}

// 측정 불가한 값(0·음수·비유한·숫자 아님)은 필드를 버리고, 소수는 반올림해 살린다.
// traceEventSchema 가 viewportX/Y 를 양의 정수로 요구하므로 여기서 맞춰 준다.
function sanitizeViewportDimension(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}

function sanitizeErrorName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return SAFE_ERROR_NAME_PATTERN.test(name) ? name : undefined;
}

// 선행 "//" 를 "/" 로 접는다. new URL("https://h//a.js").pathname 이 "//a.js" 이고
// normalizePath 가 빈 세그먼트를 보존하므로, redactUrl(...).urlPath 는 정상적으로
// 선행 "//" 를 낼 수 있다. 계약은 선행 "//" 를 fail-closed 로 거절하므로(원시
// protocol-relative filename 이 우회로로 들어오는 것을 막는 2차 방어), 여기서 접지
// 않으면 멀쩡한 경로가 조용히 버려진다.
function sanitizeErrorSource(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.trim().replace(/^\/{2,}/, "/");
  if (collapsed.length > MAX_ERROR_SOURCE) return undefined;
  return SAFE_ERROR_SOURCE_PATTERN.test(collapsed) ? collapsed : undefined;
}

function sanitizeErrorLine(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}

function sanitizeScreenContext(value: unknown): ScreenContext | undefined {
  const raw = rawScreenContextSchema.safeParse(value);
  if (!raw.success) return undefined;

  const titleMasked = sanitizeScreenText(raw.data.titleMasked);
  const target = raw.data.target ? sanitizeScreenElement(raw.data.target) : undefined;
  const layoutHints = raw.data.layoutHints
    .slice(0, MAX_LAYOUT_HINTS)
    .map((hint) => {
      const sanitized = sanitizeScreenElement(hint);
      if (sanitized === undefined) return undefined;
      // masked 는 "내용을 보여주지 않는다" 는 뜻이다. SDK 를 신뢰하지 않고 경계에서
      // 태그·role 로 직접 재판정한 뒤 텍스트를 지운다.
      const masked = hint.masked || SERVER_MASKED_TAGS.has(sanitized.tagName);
      const allowsText =
        !masked &&
        (SERVER_TEXT_TAGS.has(sanitized.tagName) ||
          (sanitized.role !== undefined && SERVER_TEXT_ROLES.has(sanitized.role)));
      if (allowsText) return { ...sanitized, masked };
      const { textMaskedOrLimited: _dropped, ...withoutText } = sanitized;
      return { ...withoutText, masked };
    })
    .filter((hint): hint is NonNullable<typeof hint> => hint !== undefined);

  const sanitized = screenContextSchema.safeParse({
    ...(titleMasked ? { titleMasked } : {}),
    viewport: {
      width: clampViewportValue(raw.data.viewport.width),
      height: clampViewportValue(raw.data.viewport.height),
    },
    ...(target ? { target } : {}),
    layoutHints,
  });

  return sanitized.success ? sanitized.data : undefined;
}

function sanitizeScreenElement(
  element: z.infer<typeof rawScreenElementSchema>,
): NonNullable<ScreenContext["target"]> | undefined {
  const tagName = element.tagName.trim().toLowerCase();
  if (!SAFE_TAG_NAME_PATTERN.test(tagName)) return undefined;

  const role = element.role?.trim();
  const selectorHash = element.selectorHash?.trim();
  const textMaskedOrLimited = sanitizeScreenText(element.textMaskedOrLimited);

  return {
    tagName,
    ...(role && isSafeElementRole(role) ? { role } : {}),
    ...(textMaskedOrLimited ? { textMaskedOrLimited } : {}),
    ...(selectorHash && isSafeElementSelectorHash(selectorHash) ? { selectorHash } : {}),
    rect: {
      x: clampRectValue(element.rect.x),
      y: clampRectValue(element.rect.y),
      width: clampRectValue(element.rect.width),
      height: clampRectValue(element.rect.height),
    },
  };
}

// redactText 는 자체 slice(0, 120) 경계 때문에 멱등이 아니다. 고정점까지 다시 마스킹해
// 서버가 SDK 의 마스킹 횟수에 의존하지 않게 한다. 그래도 남으면 그 값만 버린다.
function sanitizeScreenText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  let text = value.trim();
  for (let pass = 0; pass < 3 && redactText(text) !== text; pass += 1) {
    text = redactText(text).trim();
  }

  if (text.length === 0 || text.length > MAX_SCREEN_TEXT || redactText(text) !== text) return undefined;
  return text;
}

function clampRectValue(value: number): number {
  return Math.min(MAX_SCREEN_RECT, Math.max(0, Math.round(value)));
}

function clampViewportValue(value: number): number {
  return Math.min(MAX_VIEWPORT, Math.max(1, Math.round(value)));
}

function sanitizeTraceIdentifier(value: string, prefix: "anon" | "evt" | "page" | "sess"): string {
  if (isSafeTraceIdentifier(value, prefix)) return value;
  return `${prefix}_${nanoid(10)}`;
}

function sanitizeEventUrl(event: z.infer<typeof rawTraceEventSchema>, batchUrl: RedactedUrl): RedactedUrl {
  if (!event.urlPath?.startsWith("/")) return batchUrl;

  try {
    return redactUrl(`${batchUrl.origin}${event.urlPath}${event.urlQueryRedacted ?? ""}`);
  } catch {
    return batchUrl;
  }
}
