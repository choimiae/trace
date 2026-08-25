export interface AdminAuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  adminAppOrigin: string;
  sessionSecret: string;
  cookieSecure: boolean;
  allowedEmails: Set<string>;
  googleAllowedDomain?: string;
  sessionTtlSeconds: number;
  loginRateLimitWindowSeconds: number;
  loginRateLimitMax: number;
  oauthCookieName: "__trace_oauth";
  sessionCookieName: "__trace_admin_session";
  csrfCookieName: "__trace_csrf";
}

const DEFAULT_SESSION_TTL_SECONDS = 28800;
const DEFAULT_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 300;
const DEFAULT_LOGIN_RATE_LIMIT_MAX = 20;

export function loadAdminAuthConfig(env: NodeJS.ProcessEnv): AdminAuthConfig | undefined {
  const googleClientId = required(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = required(env.GOOGLE_CLIENT_SECRET);
  const googleRedirectUri = required(env.GOOGLE_REDIRECT_URI);
  const sessionSecret = required(env.SESSION_SECRET);
  const adminAppOrigin = required(env.ADMIN_APP_ORIGIN);
  const allowedEmails = required(env.ADMIN_ALLOWED_EMAILS);
  const googleAllowedDomain = required(env.GOOGLE_ALLOWED_DOMAIN);
  const allowedEmailSet = new Set(allowedEmails?.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));

  if (
    !googleClientId ||
    !googleClientSecret ||
    !googleRedirectUri ||
    !sessionSecret ||
    !adminAppOrigin ||
    !allowedEmails ||
    allowedEmailSet.size === 0
  ) {
    return undefined;
  }

  return {
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    adminAppOrigin,
    sessionSecret,
    cookieSecure: env.COOKIE_SECURE !== "false",
    allowedEmails: allowedEmailSet,
    ...(googleAllowedDomain ? { googleAllowedDomain } : {}),
    sessionTtlSeconds: numberEnv(env.SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS),
    loginRateLimitWindowSeconds: numberEnv(
      env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    ),
    loginRateLimitMax: numberEnv(env.LOGIN_RATE_LIMIT_MAX, DEFAULT_LOGIN_RATE_LIMIT_MAX),
    oauthCookieName: "__trace_oauth",
    sessionCookieName: "__trace_admin_session",
    csrfCookieName: "__trace_csrf",
  };
}

export function assertDeployableAdminAuthConfig(config: AdminAuthConfig, env: NodeJS.ProcessEnv): void {
  if (!config.cookieSecure && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error("COOKIE_SECURE must be true outside local development and test");
  }
}

function required(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function numberEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}
