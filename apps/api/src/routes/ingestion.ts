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
  viewportX: z.number().int().positive().optional(),
  viewportY: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).default({}),
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
    ...(event.viewportX === undefined ? {} : { viewportX: event.viewportX }),
    ...(event.viewportY === undefined ? {} : { viewportY: event.viewportY }),
    metadata: redactMetadata(event.metadata),
    ...(screenContext ? { screenContext } : {}),
  };
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
      return sanitized === undefined ? undefined : { ...sanitized, masked: hint.masked };
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
