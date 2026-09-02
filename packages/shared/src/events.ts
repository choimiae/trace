import { z } from "zod";
import {
  isSafeElementRole,
  isSafeElementSelectorHash,
  isSafeTraceIdentifier,
  normalizePath,
  redactText,
} from "./privacy.js";

export const eventTypeSchema = z.enum([
  "page_view",
  "page_leave",
  "click",
  "scroll",
  "idle",
  "dead_click",
  "rage_click",
  "js_error",
  "api_error",
  "web_vital",
  "custom_event",
  "form_start",
  "field_focus",
  "field_blur",
  "form_submit",
  "form_abandon",
]);

export const isoDateStringSchema = z.string().datetime();

const redactedQueryValue = "[redacted]";
const sensitiveQueryKeyPattern =
  /(?:email|token|password|secret|auth|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|phone|address|input|value|name|user|ssn|credit|card)/i;
const sensitiveAnalyticsIdentifierSegments = new Set([
  "token",
  "secret",
  "key",
  "password",
  "auth",
  "session",
  "cookie",
]);
const hasSensitiveAnalyticsIdentifierSegments = (value: string) => {
  const segments = value.split("_");

  return segments.some((segment, index) => {
    const nextSegment = segments[index + 1];

    return (
      sensitiveAnalyticsIdentifierSegments.has(segment) ||
      /\d{9,}/.test(segment) ||
      (segment === "sk" && nextSegment === "live") ||
      (segment === "user" && nextSegment !== undefined && /^\d+$/.test(nextSegment))
    );
  });
};
const analyticsIdentifierSchema = z
  .string()
  .max(64)
  .regex(
    /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/,
    "Metadata must be a lowercase snake_case analytics identifier",
  )
  .refine(
    (value) => !hasSensitiveAnalyticsIdentifierSegments(value),
    "Metadata must not contain sensitive or identity-like segments",
  );

const safeMetadataSchema = z.object({
  source: z.enum(["auto", "manual", "sdk"]).optional(),
  eventName: analyticsIdentifierSchema.optional(),
  feature: analyticsIdentifierSchema.optional(),
  target: analyticsIdentifierSchema.optional(),
  errorType: analyticsIdentifierSchema.optional(),
  status: z.enum(["success", "failure", "timeout", "cancelled"]).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  metric: analyticsIdentifierSchema.optional(),
  durationMs: z.number().int().nonnegative().max(600000).optional(),
  responseMs: z.number().int().nonnegative().max(600000).optional(),
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
  selectorHash: z.string().trim().refine(isSafeElementSelectorHash).optional(),
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
  screenContext: screenContextSchema.optional(),
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

export const issueStatusSchema = z.enum(["new", "reviewing", "ignored", "resolved"]);
export const issueTypeSchema = z.enum([
  "dead_click_cluster",
  "rage_click",
  "long_pause",
  "scroll_friction",
  "error_friction",
  "form_friction",
]);

export const issueSchema = z.object({
  issueId: z.string().min(1),
  projectId: z.string().min(1),
  issueType: issueTypeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  affectedSessionsCount: z.number().int().nonnegative(),
  affectedUsersCount: z.number().int().nonnegative(),
  severityScore: z.number().int().min(0).max(100),
  firstSeenAt: isoDateStringSchema,
  lastSeenAt: isoDateStringSchema,
  trend: z.enum(["up", "flat", "down"]),
  relatedUrlPath: z.string().optional(),
  relatedFeatureId: z.string().optional(),
  exampleSessionIds: z.array(z.string()).default([]),
  representativeEvent: traceEventSchema.optional(),
  status: issueStatusSchema,
});

export const dashboardSummarySchema = z.object({
  frictionScore: z.number().int().min(0).max(100),
  affectedSessionsCount: z.number().int().nonnegative(),
  newIssuesCount: z.number().int().nonnegative(),
  resolvedOrIgnoredIssuesCount: z.number().int().nonnegative(),
  totalEventsCount: z.number().int().nonnegative(),
  insight: z.string(),
  trend: z.array(z.object({ date: z.string(), score: z.number().int().min(0).max(100) })),
  issueTypeDistribution: z.array(z.object({ issueType: issueTypeSchema, count: z.number().int().nonnegative() })),
  topTargets: z.array(z.object({ label: z.string(), count: z.number().int().nonnegative() })),
});

export type EventType = z.infer<typeof eventTypeSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type EventBatch = z.infer<typeof eventBatchSchema>;
export type AdminProject = z.infer<typeof adminProjectSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type SessionTimelineEvent = TraceEvent;
