import { nanoid } from "nanoid";
import type { AdminAuthConfig } from "./config.js";
import { hashSecret, parseCookieHeader, serializeCookie, signValue, verifySignedValue } from "./cookies.js";
import type { AdminSessionRecord, AdminUserRecord, TraceStore } from "../store/types.js";

export interface AuthenticatedAdmin {
  adminUserId: string;
  session: AdminSessionRecord;
}

interface CreateAdminSessionForUserInput {
  store: TraceStore;
  config: AdminAuthConfig;
  user: AdminUserRecord;
  now?: Date;
}

interface RequireAdminSessionInput {
  store: TraceStore;
  config: AdminAuthConfig;
  cookieHeader: string | undefined;
  now?: Date;
}

export async function createAdminSessionForUser(
  input: CreateAdminSessionForUserInput,
): Promise<{ cookie: string; csrfCookie: string; csrfToken: string; session: AdminSessionRecord }> {
  const now = input.now ?? new Date();
  const rawSessionId = `sess_${nanoid(32)}`;
  const sessionIdHash = hashSecret(rawSessionId, input.config.sessionSecret);
  const expiresAt = new Date(now.getTime() + input.config.sessionTtlSeconds * 1000);
  const session = await input.store.createAdminSession({
    sessionIdHash,
    adminUserId: input.user.adminUserId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastSeenAt: now.toISOString(),
  });
  const csrfToken = nanoid(32);

  return {
    cookie: serializeCookie(input.config.sessionCookieName, signValue(rawSessionId, input.config.sessionSecret), {
      httpOnly: true,
      secure: input.config.cookieSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: input.config.sessionTtlSeconds,
    }),
    csrfCookie: serializeCookie(input.config.csrfCookieName, csrfToken, {
      secure: input.config.cookieSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: input.config.sessionTtlSeconds,
    }),
    csrfToken,
    session,
  };
}

export async function requireAdminSession(
  input: RequireAdminSessionInput,
): Promise<AuthenticatedAdmin | { error: "admin_auth_required" }> {
  const signedSessionId = parseCookieHeader(input.cookieHeader).get(input.config.sessionCookieName);
  if (!signedSessionId) return { error: "admin_auth_required" };

  const rawSessionId = verifySignedValue(signedSessionId, input.config.sessionSecret);
  if (!rawSessionId) return { error: "admin_auth_required" };

  const sessionIdHash = hashSecret(rawSessionId, input.config.sessionSecret);
  const session = await input.store.getAdminSession(sessionIdHash);
  const now = input.now ?? new Date();
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= now.getTime()) {
    return { error: "admin_auth_required" };
  }

  // 허용 목록이 유일한 접근 게이트다. 목록에서 빠진 관리자의 기존 세션은 다음 요청에서 끊는다.
  const user = await input.store.getAdminUser(session.adminUserId);
  if (!user || !input.config.allowedEmails.has(user.email.toLowerCase())) {
    return { error: "admin_auth_required" };
  }

  await input.store.touchAdminSession(sessionIdHash, now.toISOString());
  return { adminUserId: session.adminUserId, session };
}

export function buildClearedAuthCookies(config: AdminAuthConfig): string[] {
  return [
    serializeCookie(config.sessionCookieName, "", {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: 0,
    }),
    serializeCookie(config.csrfCookieName, "", {
      secure: config.cookieSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: 0,
    }),
  ];
}
