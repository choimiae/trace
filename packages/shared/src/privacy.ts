const REDACTED = "[redacted]";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-.\s]?\d{4}\b/g;
const LONG_NUMBER_PATTERN = /\b\d{9,}\b/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_LIKE_PATH_PATTERN = /^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_-]+$|^[A-Za-z0-9_-]{32,}$/;
const SAFE_QUERY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SENSITIVE_QUERY_KEY_PATTERN =
  /(?:email|token|password|secret|auth|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|phone|address|input|value|name|user|ssn|credit|card)/i;
const SENSITIVE_FIELD_HINTS = ["email", "phone", "tel", "password", "card", "address", "name", "ssn"];
const TRACE_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_-]{1,64}$/;
const ELEMENT_SELECTOR_HASH_PATTERN = /^[0-9a-f]{1,16}$/i;
const SAFE_ELEMENT_ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const SENSITIVE_ANALYTICS_IDENTIFIER_SEGMENTS = new Set([
  "token",
  "secret",
  "key",
  "password",
  "auth",
  "session",
  "cookie",
]);
const DYNAMIC_PARENT_PATH_SEGMENTS = new Set([
  "account",
  "accounts",
  "customer",
  "customers",
  "invite",
  "invites",
  "invitation",
  "invitations",
  "member",
  "members",
  "org",
  "orgs",
  "organization",
  "organizations",
  "people",
  "person",
  "profile",
  "profiles",
  "project",
  "projects",
  "reset",
  "session",
  "sessions",
  "team",
  "teams",
  "user",
  "users",
]);
const SAFE_SOURCE_VALUES = new Set(["auto", "manual", "sdk"]);
const SAFE_STATUS_VALUES = new Set(["success", "failure", "timeout", "cancelled"]);
const SAFE_METHOD_VALUES = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ANALYTICS_METADATA_KEYS = new Set(["eventName", "feature", "target", "errorType", "metric"]);

export interface RedactedUrl {
  origin: string;
  urlPath: string;
  urlQueryRedacted: string;
  urlQueryKeys: string[];
}

export type SafeMetadata = Record<string, string | number>;

export function redactText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, REDACTED)
    .replace(LONG_NUMBER_PATTERN, REDACTED)
    .slice(0, 120);
}

export function redactUrl(rawUrl: string): RedactedUrl {
  const url = new URL(rawUrl);
  const urlQueryKeys: string[] = [];
  let unsafeKeyCount = 0;

  for (const queryKey of url.searchParams.keys()) {
    if (isSafeQueryKey(queryKey)) {
      urlQueryKeys.push(queryKey);
    } else {
      unsafeKeyCount += 1;
      urlQueryKeys.push(`redacted_param_${unsafeKeyCount}`);
    }
  }

  return {
    origin: url.origin,
    urlPath: normalizePath(url.pathname),
    urlQueryRedacted:
      urlQueryKeys.length === 0
        ? ""
        : `?${urlQueryKeys.map((key) => `${encodeURIComponent(key)}=${REDACTED}`).join("&")}`,
    urlQueryKeys,
  };
}

export function normalizePath(pathname: string): string {
  const segments = pathname.split("/");

  return segments
    .map((segment, index) => {
      if (shouldRedactPathSegment(segment, segments[index - 1])) return ":id";
      return safeDecodePathSegment(segment);
    })
    .join("/");
}

export function isSafeTraceIdentifier(value: string, prefix?: string): boolean {
  if (!TRACE_IDENTIFIER_PATTERN.test(value)) return false;
  if (prefix && !value.startsWith(`${prefix}_`)) return false;
  return !containsSensitiveText(value) && !TOKEN_LIKE_PATH_PATTERN.test(value) && !hasSensitiveIdentifierSegments(value);
}

export function isSafeElementSelectorHash(value: string): boolean {
  return ELEMENT_SELECTOR_HASH_PATTERN.test(value);
}

export function isSafeElementRole(value: string): boolean {
  return SAFE_ELEMENT_ROLE_PATTERN.test(value) && !containsSensitiveText(value);
}

export function redactMetadata(metadata: Record<string, unknown>): SafeMetadata {
  const safeMetadata: SafeMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    const storedKey = key === "name" ? "eventName" : key;

    if (ANALYTICS_METADATA_KEYS.has(storedKey) && typeof value === "string" && isSafeAnalyticsIdentifier(value)) {
      safeMetadata[storedKey] = value;
      continue;
    }

    if (storedKey === "source" && typeof value === "string" && SAFE_SOURCE_VALUES.has(value)) {
      safeMetadata.source = value;
      continue;
    }

    if (storedKey === "status" && typeof value === "string" && SAFE_STATUS_VALUES.has(value)) {
      safeMetadata.status = value;
      continue;
    }

    if (storedKey === "method" && typeof value === "string" && SAFE_METHOD_VALUES.has(value)) {
      safeMetadata.method = value;
      continue;
    }

    if ((storedKey === "durationMs" || storedKey === "responseMs") && isSafeDuration(value)) {
      safeMetadata[storedKey] = value;
      continue;
    }

    if (storedKey === "score" && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) {
      safeMetadata.score = value;
    }
  }

  return safeMetadata;
}

export function isSensitiveField(element: Pick<HTMLInputElement, "tagName" | "type" | "name" | "id">): boolean {
  const tagName = element.tagName.toLowerCase();
  const type = element.type?.toLowerCase() ?? "";
  const hints = `${element.name ?? ""} ${element.id ?? ""}`.toLowerCase();

  if (tagName === "input" && ["password", "email", "tel", "number"].includes(type)) return true;
  return SENSITIVE_FIELD_HINTS.some((hint) => hints.includes(hint));
}

function isSafeQueryKey(queryKey: string): boolean {
  return SAFE_QUERY_KEY_PATTERN.test(queryKey) && !SENSITIVE_QUERY_KEY_PATTERN.test(queryKey);
}

function shouldRedactPathSegment(segment: string, previousSegment: string | undefined): boolean {
  if (segment.length === 0) return false;

  const decodedSegment = safeDecodePathSegment(segment);
  const previousDecodedSegment = previousSegment ? safeDecodePathSegment(previousSegment).toLowerCase() : undefined;

  return (
    containsSensitiveText(decodedSegment) ||
    /^\d+$/.test(decodedSegment) ||
    /^[0-9a-f]{8,}$/i.test(decodedSegment) ||
    UUID_PATTERN.test(decodedSegment) ||
    TOKEN_LIKE_PATH_PATTERN.test(decodedSegment) ||
    (previousDecodedSegment !== undefined && DYNAMIC_PARENT_PATH_SEGMENTS.has(previousDecodedSegment))
  );
}

function safeDecodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function containsSensitiveText(value: string): boolean {
  const hasSensitiveText = EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value) || LONG_NUMBER_PATTERN.test(value);
  EMAIL_PATTERN.lastIndex = 0;
  PHONE_PATTERN.lastIndex = 0;
  LONG_NUMBER_PATTERN.lastIndex = 0;
  return hasSensitiveText;
}

function hasSensitiveIdentifierSegments(value: string): boolean {
  const segments = value.toLowerCase().split("_").slice(1);

  return segments.some((segment, index) => {
    const nextSegment = segments[index + 1];

    return (
      SENSITIVE_ANALYTICS_IDENTIFIER_SEGMENTS.has(segment) ||
      /\d{9,}/.test(segment) ||
      (segment === "sk" && nextSegment === "live")
    );
  });
}

function isSafeAnalyticsIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value) && value.length <= 64 && !hasSensitiveAnalyticsIdentifierSegments(value);
}

function hasSensitiveAnalyticsIdentifierSegments(value: string): boolean {
  const segments = value.split("_");

  return segments.some((segment, index) => {
    const nextSegment = segments[index + 1];

    return (
      SENSITIVE_ANALYTICS_IDENTIFIER_SEGMENTS.has(segment) ||
      /\d{9,}/.test(segment) ||
      (segment === "sk" && nextSegment === "live") ||
      (segment === "user" && nextSegment !== undefined && /^\d+$/.test(nextSegment))
    );
  });
}

function isSafeDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 600000;
}
