import { z } from "zod";

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
const sensitiveEmailPattern = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const koreanPhonePattern = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/;
const longNumberPattern = /\d{9,}/;

const safeMetadataStringSchema = z.string().refine(
  (value) =>
    !sensitiveEmailPattern.test(value) &&
    !koreanPhonePattern.test(value) &&
    !longNumberPattern.test(value),
  "Metadata contains a sensitive string",
);

const safeMetadataValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    safeMetadataStringSchema,
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(safeMetadataValueSchema),
    z.record(safeMetadataValueSchema),
  ]),
);

const redactedUrlSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);

  for (const queryValue of url.searchParams.values()) {
    if (queryValue !== redactedQueryValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL query values must be redacted",
      });
      return;
    }
  }
});

const redactedQuerySchema = z.string().superRefine((value, context) => {
  if (!value.startsWith("?") || value.length === 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Query must start with ? and contain redacted values",
    });
    return;
  }

  for (const queryValue of new URLSearchParams(value).values()) {
    if (queryValue !== redactedQueryValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL query values must be redacted",
      });
      return;
    }
  }
});

export const traceEventSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  timestamp: isoDateStringSchema,
  type: eventTypeSchema,
  urlPath: z.string().min(1),
  urlQueryRedacted: redactedQuerySchema.optional(),
  titleMasked: z.string().max(120).optional(),
  elementSelectorHash: z.string().optional(),
  elementRole: z.string().optional(),
  elementTextMaskedOrLimited: z.string().max(120).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  viewportX: z.number().int().positive().optional(),
  viewportY: z.number().int().positive().optional(),
  metadata: z.record(safeMetadataValueSchema).default({}),
});

export const eventBatchSchema = z.object({
  projectId: z.string().min(1),
  anonymousUserId: z.string().min(1),
  sessionId: z.string().min(1),
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
  status: issueStatusSchema,
});

export const dashboardSummarySchema = z.object({
  frictionScore: z.number().int().min(0).max(100),
  affectedSessionsCount: z.number().int().nonnegative(),
  newIssuesCount: z.number().int().nonnegative(),
  resolvedOrIgnoredIssuesCount: z.number().int().nonnegative(),
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
