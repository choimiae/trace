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

// 같은 정규식의 사본이 packages/sdk/src/collectors.ts 와
// apps/api/src/routes/ingestion.ts 의 SAFE_ERROR_NAME_PATTERN 에 있다. 공유 상수로
// 묶지 않는 것은 기존 관례이므로 셋을 함께 고친다. 여기만 좁히면 정리기(SDK·수집 API)가
// 통과시키던 값이 이 계약에서 걸려 배치 전체가 400 이 되고, "수집 API 는 거절이 아니라
// 정리한다" 가 깨진다. 넓히는 방향도 정리기가 따라오지 않으면 의미가 없다.
const errorNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);

// redactUrl(...).urlPath 결과 형태만 받는다. origin·쿼리·해시가 붙은 값은 거절해서
// 원시 filename 이 그대로 저장되는 경로를 계약에서 막는다.
//
// 선행 "//" 도 fail-closed 로 거절한다. new URL("https://h//a.js").pathname 은
// "//a.js" 이고 normalizePath 가 빈 세그먼트를 보존하므로 정상 경로도 이 형태가 될
// 수 있지만, 그 모양만으로는 원시 protocol-relative filename 과 구분할 수 없다.
// 그래서 수집 단계(sanitizeErrorSource)가 선행 "//" 를 "/" 로 접어서 넘기고,
// 이 계약은 접히지 않은 값을 거절하는 2차 방어로 남는다. 느슨하게 바꾸지 말 것.
//
// 사본 위치: packages/sdk/src/collectors.ts 의 SAFE_ERROR_SOURCE_SHAPE 와
// apps/api/src/routes/ingestion.ts 의 SAFE_ERROR_SOURCE_PATTERN. 셋의 모양이 일부러
// 다르다 — lookahead 는 여기에만 있다. 수집 API 사본은 선행 "//" 를 먼저 접으므로
// 이 계약이 거절할 값을 낼 수 없다. 여기만 좁히면 그 정리 경로가 배치 전체 400 으로
// 바뀌어 "수집 API 는 거절이 아니라 정리한다" 가 깨진다. 셋을 함께 고칠 것.
const errorSourceSchema = z
  .string()
  .trim()
  .max(256)
  .regex(/^\/(?!\/)[^\s?#]*$/);

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

// masked 와 textMaskedOrLimited 를 동시에 가진 힌트는 정제 파이프라인이 절대
// 만들면 안 되는 상태다. 정상 경로는 이 refine 에 절대 걸리지 않는다 —
// sanitizeScreenContext 가 masked 힌트의 텍스트를 먼저 지우기 때문이다. 그래도
// 걸린다면 그 정제 로직의 회귀를 뜻하므로, 조용히 저장하는 대신 파싱을 실패시켜
// 크게 알린다 (eventBatchSchema.parse 가 400 을 낸다).
const screenLayoutHintSchema = screenElementSchema
  .extend({ masked: z.boolean() })
  .refine((hint) => !(hint.masked && hint.textMaskedOrLimited !== undefined), {
    message: "masked layout hints must not carry text",
    path: ["textMaskedOrLimited"],
  });

export const screenContextSchema = z.object({
  titleMasked: safeScreenTextSchema.optional(),
  viewport: z.object({
    width: z.number().int().min(1).max(10000),
    height: z.number().int().min(1).max(10000),
  }),
  target: screenElementSchema.optional(),
  layoutHints: screenLayoutHintSchema.array().max(12).default([]),
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
  errorName: errorNameSchema.optional(),
  errorSource: errorSourceSchema.optional(),
  errorLine: z.number().int().positive().optional(),
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
  // 상한은 생산자(detect.ts 의 errorSignature)가 낼 수 있는 최대 길이에 맞춘다.
  // errorName 64 + " · " 3 + errorSource 256 + ":" 1 + errorLine 21 = 345.
  // errorLine 은 traceEventSchema 에서 상한이 없으므로(z.number().int().positive()),
  // 10 진 표기가 가장 긴 값(1e21 미만, 21 자)을 기준으로 잡는다. 계약을 더 좁히면
  // 정상 서명이 거절된다 — 자르는 쪽은 답이 아니다. 잘린 경로는 다른 파일을 가리킨다.
  relatedErrorSignature: z.string().trim().min(1).max(345).optional(),
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
