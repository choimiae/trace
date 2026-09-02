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
import type { EventBatch, RedactedUrl, TraceEvent } from "@trace/shared";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { detectIssues } from "../detection/detect.js";
import type { EventRetentionConfig } from "../retention/config.js";
import { runEventRetention } from "../retention/events.js";
import type { TraceStore } from "../store/types.js";

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
  screenContext: screenContextSchema.optional(),
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
    ...(event.screenContext ? { screenContext: event.screenContext } : {}),
  };
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
