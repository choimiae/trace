import { z } from "zod";
import { isSafeElementRole, isSafeElementSelectorHash, isSafeTraceIdentifier, normalizePath } from "./privacy.js";

export const eventTypeSchema = z.enum(["page_view", "page_leave", "click", "scroll"]);

export const isoDateStringSchema = z.string().datetime();

const redactedQueryValue = "[redacted]";
const sensitiveQueryKeyPattern =
  /(?:email|token|password|secret|auth|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|phone|address|input|value|name|user|ssn|credit|card)/i;
// 남은 metadata 는 스크롤 도달 하나뿐이다(collectors.ts). strict 라 새 키는 거절된다 —
// SDK 가 새 키를 보내려면 여기부터 넓혀야 한다.
const safeMetadataSchema = z.object({
  metric: z.literal("scroll_depth").optional(),
  score: z.number().finite().min(0).max(100).optional(),
}).strict().default({});

const validateRedactedQuery = (query: URLSearchParams, context: z.RefinementCtx) => {
  for (const [queryKey, queryValue] of query.entries()) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(queryKey) || sensitiveQueryKeyPattern.test(queryKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL query keys must be non-sensitive safe labels",
      });
      return;
    }

    if (queryValue !== redactedQueryValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL query values must be redacted",
      });
      return;
    }
  }
};

const redactedUrlSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);

  if (normalizePath(url.pathname) !== url.pathname) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "URL path must not contain identity-like or token-like segments",
    });
    return;
  }

  validateRedactedQuery(url.searchParams, context);
});

const redactedQuerySchema = z.string().superRefine((value, context) => {
  if (!value.startsWith("?") || value.length === 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Query must start with ? and contain redacted values",
    });
    return;
  }

  validateRedactedQuery(new URLSearchParams(value), context);
});

export const traceEventSchema = z.object({
  eventId: z.string().refine((value) => isSafeTraceIdentifier(value, "evt")),
  sessionId: z.string().refine((value) => isSafeTraceIdentifier(value, "sess")),
  pageId: z.string().refine((value) => isSafeTraceIdentifier(value, "page")),
  timestamp: isoDateStringSchema,
  type: eventTypeSchema,
  urlPath: z.string().min(1).refine((value) => normalizePath(value) === value),
  urlQueryRedacted: redactedQuerySchema.optional(),
  titleMasked: z.string().max(120).optional(),
  elementSelectorHash: z.string().refine(isSafeElementSelectorHash).optional(),
  elementRole: z.string().refine(isSafeElementRole).optional(),
  elementTextMaskedOrLimited: z.string().max(120).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  viewportX: z.number().int().positive().optional(),
  viewportY: z.number().int().positive().optional(),
  metadata: safeMetadataSchema,
});

export const eventBatchSchema = z.object({
  projectId: z.string().refine((value) => isSafeTraceIdentifier(value, "proj")),
  anonymousUserId: z.string().refine((value) => isSafeTraceIdentifier(value, "anon")),
  sessionId: z.string().refine((value) => isSafeTraceIdentifier(value, "sess")),
  sentAt: isoDateStringSchema,
  sdkVersion: z.string().min(1),
  url: redactedUrlSchema,
  events: z.array(traceEventSchema).min(1).max(100),
});

export const adminProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  allowedDomains: z.array(z.string().url()),
  privacyConfig: z.object({
    strictMasking: z.literal(true),
    queryRedaction: z.literal(true),
    inputCapture: z.literal(false),
  }),
  createdAt: isoDateStringSchema,
});

export type EventType = z.infer<typeof eventTypeSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type EventBatch = z.infer<typeof eventBatchSchema>;
export type AdminProject = z.infer<typeof adminProjectSchema>;
export type SessionTimelineEvent = TraceEvent;
