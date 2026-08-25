import {
  eventBatchSchema,
  eventTypeSchema,
  isoDateStringSchema,
  redactMetadata,
  redactText,
  redactUrl,
} from "@trace/shared";
import type { EventBatch, TraceEvent } from "@trace/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TraceStore } from "../store/types";

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

export async function registerIngestionRoutes(app: FastifyInstance, options: { store: TraceStore }) {
  app.post("/v1/events/batch", async (request, reply) => {
    const rawBatch = rawEventBatchSchema.parse(request.body);
    const project = await options.store.getProject(rawBatch.projectId);
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const redactedUrl = redactUrl(rawBatch.url);
    const origin = request.headers.origin ?? redactedUrl.origin;
    if (!project.allowedDomains.includes(origin) || !project.allowedDomains.includes(redactedUrl.origin)) {
      return reply.code(403).send({ error: "domain_not_allowed" });
    }

    const sanitizedBatch = eventBatchSchema.parse({
      ...rawBatch,
      url: `${redactedUrl.origin}${redactedUrl.urlPath}${redactedUrl.urlQueryRedacted}`,
      events: rawBatch.events.map((event) => sanitizeEvent(event, redactedUrl.urlPath, redactedUrl.urlQueryRedacted)),
    }) satisfies EventBatch;

    await options.store.saveBatch(sanitizedBatch);
    return reply.code(202).send({ accepted: sanitizedBatch.events.length });
  });
}

function sanitizeEvent(
  event: z.infer<typeof rawTraceEventSchema>,
  urlPath: string,
  urlQueryRedacted: string,
): TraceEvent {
  return {
    eventId: event.eventId,
    sessionId: event.sessionId,
    pageId: event.pageId,
    timestamp: event.timestamp,
    type: event.type,
    urlPath,
    ...(urlQueryRedacted ? { urlQueryRedacted } : {}),
    ...(event.titleMasked ? { titleMasked: redactText(event.titleMasked) } : {}),
    ...(event.elementSelectorHash ? { elementSelectorHash: event.elementSelectorHash } : {}),
    ...(event.elementRole ? { elementRole: event.elementRole } : {}),
    ...(event.elementTextMaskedOrLimited ? { elementTextMaskedOrLimited: redactText(event.elementTextMaskedOrLimited) } : {}),
    ...(event.x === undefined ? {} : { x: event.x }),
    ...(event.y === undefined ? {} : { y: event.y }),
    ...(event.viewportX === undefined ? {} : { viewportX: event.viewportX }),
    ...(event.viewportY === undefined ? {} : { viewportY: event.viewportY }),
    metadata: redactMetadata(event.metadata),
  };
}
