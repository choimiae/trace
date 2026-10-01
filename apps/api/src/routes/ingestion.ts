import {
  eventBatchSchema,
  isSafeElementRole,
  isSafeElementSelectorHash,
  eventTypeSchema,
  isSafeTraceIdentifier,
  isoDateStringSchema,
  redactText,
  redactUrl,
} from "@trace/shared";
import type { EventBatch, RedactedUrl, TraceEvent } from "@trace/shared";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { EventRetentionConfig } from "../retention/config.js";
import { runEventRetention } from "../retention/events.js";
import type { TraceStore } from "../store/types.js";

// 계약이 받는 종류가 아니면 배치를 떨어뜨리지 않고 버린다 — 수집 API 는 거절이 아니라 정리한다.
const KEPT_EVENT_TYPES: ReadonlySet<string> = new Set<string>(eventTypeSchema.options);

// 종류부터 본다. 걷어낸 종류(js_error·custom 등)는 옛 SDK 가 보내는 모양 그대로
// 오므로, 버릴 이벤트의 필드까지 검사하면 같은 배치의 멀쩡한 이벤트가 400 으로
// 함께 떨어진다. 남길 종류만 필드를 검사한다 - 그쪽이 틀리면 지금처럼 400 이다.
function isKeptEvent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && KEPT_EVENT_TYPES.has(type);
}

const rawTraceEventSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  timestamp: isoDateStringSchema,
  type: z.string(),
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
});

const rawEventBatchSchema = z.object({
  projectId: z.string().min(1),
  anonymousUserId: z.string().min(1),
  sessionId: z.string().min(1),
  sentAt: isoDateStringSchema,
  sdkVersion: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.unknown()).min(1).max(100),
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

      const keptEvents = rawBatch.events.filter(isKeptEvent).map((event) => rawTraceEventSchema.parse(event));
      if (keptEvents.length === 0) return reply.code(202).send({ accepted: 0 });

      const sessionId = sanitizeTraceIdentifier(rawBatch.sessionId, "sess");
      const sanitizedBatch = eventBatchSchema.parse({
        ...rawBatch,
        anonymousUserId: sanitizeTraceIdentifier(rawBatch.anonymousUserId, "anon"),
        sessionId,
        url: `${redactedUrl.origin}${redactedUrl.urlPath}${redactedUrl.urlQueryRedacted}`,
        events: keptEvents.map((event) => sanitizeEvent(event, redactedUrl, sessionId)),
      }) satisfies EventBatch;

      await options.store.saveBatch(sanitizedBatch);
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
  const viewportX = sanitizeViewportDimension(event.viewportX);
  const viewportY = sanitizeViewportDimension(event.viewportY);

  return {
    eventId: sanitizeTraceIdentifier(event.eventId, "evt"),
    sessionId: isSafeTraceIdentifier(event.sessionId, "sess") ? event.sessionId : batchSessionId,
    pageId: sanitizeTraceIdentifier(event.pageId, "page"),
    timestamp: event.timestamp,
    type: event.type as TraceEvent["type"],
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
    metadata: sanitizeMetadata(event.metadata),
  };
}

// 계약이 받는 metadata 는 스크롤 도달(metric·score)뿐이다. 그 밖의 키와 범위 밖 값은
// 배치를 떨어뜨리지 않고 버린다 — 옛 SDK 가 보내는 eventName 등이 여기서 사라진다.
function sanitizeMetadata(metadata: Record<string, unknown>): TraceEvent["metadata"] {
  const { metric, score } = metadata;
  if (metric !== "scroll_depth") return {};
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) return { metric };
  return { metric, score };
}

// 측정 불가한 값(0·음수·비유한·숫자 아님)은 필드를 버리고, 소수는 반올림해 살린다.
// traceEventSchema 가 viewportX/Y 를 양의 정수로 요구하므로 여기서 맞춰 준다.
function sanitizeViewportDimension(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
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
