import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AdminAuthConfig } from "../auth/config.js";
import { parseCookieHeader, serializeCookie } from "../auth/cookies.js";
import { verifyCsrfRequest } from "../auth/csrf.js";
import {
  createOAuthStateCookie,
  createOAuthStateStore,
  type GoogleOAuthClient,
  readOAuthStateCookie,
} from "../auth/google.js";
import { createFixedWindowRateLimiter } from "../auth/rate-limit.js";
import { buildClearedAuthCookies, createAdminSessionForUser, requireAdminSession } from "../auth/session.js";
import type { AdminRole, TraceStore } from "../store/types.js";

export interface AuthMeResponse {
  user: { adminUserId: string; email: string; name?: string; pictureUrl?: string };
  projects: Array<{ projectId: string; role: AdminRole }>;
  csrfToken: string;
}

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: { store: TraceStore; config: AdminAuthConfig; googleOAuthClient: GoogleOAuthClient },
) {
  const stateStore = createOAuthStateStore();
  const rateLimiter = createFixedWindowRateLimiter({
    windowMs: options.config.loginRateLimitWindowSeconds * 1000,
    max: options.config.loginRateLimitMax,
  });

  app.get("/auth/google/start", async (request, reply) => {
    if (!consumeLoginRateLimit(rateLimiter, request, "start")) {
      return reply.code(429).send({ error: "login_rate_limited" });
    }

    const oauthState = createOAuthStateCookie({ config: options.config });
    stateStore.save(oauthState.state, oauthState.expiresAtMs);
    const authorizationUrl = options.googleOAuthClient.getAuthorizationUrl({
      state: oauthState.state,
      nonce: oauthState.nonce,
      codeChallenge: createCodeChallenge(oauthState.codeVerifier),
    });

    return reply.header("set-cookie", oauthState.cookie).redirect(authorizationUrl.toString());
  });

  app.get("/auth/google/callback", async (request, reply) => {
    if (!consumeLoginRateLimit(rateLimiter, request, "callback")) {
      return reply.code(429).send({ error: "login_rate_limited" });
    }

    const callback = callbackSchema.safeParse(request.query);
    const oauthState = callback.success
      ? readOAuthStateCookie({ config: options.config, cookieHeader: request.headers.cookie })
      : undefined;

    if (!callback.success || !oauthState || oauthState.state !== callback.data.state || !stateStore.consume(callback.data.state)) {
      await auditLoginFailure(options.store, "oauth_state_invalid");
      return reply.code(401).send({ error: "oauth_state_invalid" });
    }

    const clearedOauthCookie = clearOAuthStateCookie(options.config);
    try {
      const token = await options.googleOAuthClient.exchangeCode({
        code: callback.data.code,
        codeVerifier: oauthState.codeVerifier,
      });
      const profile = await options.googleOAuthClient.verifyIdToken({ idToken: token.idToken, nonce: oauthState.nonce });
      const user = await options.store.upsertAdminUserFromGoogle({
        googleSub: profile.sub,
        email: profile.email,
        emailVerified: profile.emailVerified,
        ...(profile.name === undefined ? {} : { name: profile.name }),
        ...(profile.pictureUrl === undefined ? {} : { pictureUrl: profile.pictureUrl }),
        now: new Date().toISOString(),
      });
      const session = await createAdminSessionForUser({ store: options.store, config: options.config, user });
      await options.store.createAuditLog({
        adminUserId: user.adminUserId,
        action: "auth.login_success",
        createdAt: new Date().toISOString(),
        metadata: {},
      });

      return reply
        .header("set-cookie", [clearedOauthCookie, session.cookie, session.csrfCookie])
        .redirect(options.config.adminAppOrigin);
    } catch {
      await auditLoginFailure(options.store, "oauth_token_invalid");
      return reply.header("set-cookie", clearedOauthCookie).code(401).send({ error: "oauth_token_invalid" });
    }
  });

  app.get("/auth/me", async (request, reply): Promise<AuthMeResponse | ReturnType<typeof reply.code>> => {
    const authenticated = await requireAdminSession({
      store: options.store,
      config: options.config,
      cookieHeader: request.headers.cookie,
    });
    if ("error" in authenticated) return reply.code(401).send({ error: authenticated.error });

    const user = await options.store.getAdminUser(authenticated.adminUserId);
    if (!user) return reply.code(401).send({ error: "admin_auth_required" });

    const csrfCookie = parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName);
    const csrfToken = csrfCookie ?? nanoid(32);
    if (!csrfCookie) {
      reply.header("set-cookie", createCsrfCookie(options.config, csrfToken));
    }
    const memberships = await options.store.listProjectMembershipsForUser(user.adminUserId);

    return {
      user: {
        adminUserId: user.adminUserId,
        email: user.email,
        ...(user.name ? { name: user.name } : {}),
        ...(user.pictureUrl ? { pictureUrl: user.pictureUrl } : {}),
      },
      projects: memberships.map(({ projectId, role }) => ({ projectId, role })),
      csrfToken,
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const authenticated = await requireAdminSession({
      store: options.store,
      config: options.config,
      cookieHeader: request.headers.cookie,
    });
    if ("error" in authenticated) return reply.code(401).send({ error: authenticated.error });

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    await options.store.revokeAdminSession(authenticated.session.sessionIdHash, new Date().toISOString());
    return reply.header("set-cookie", buildClearedAuthCookies(options.config)).code(204).send();
  });
}

function consumeLoginRateLimit(
  rateLimiter: ReturnType<typeof createFixedWindowRateLimiter>,
  request: FastifyRequest,
  route: "start" | "callback",
): boolean {
  return rateLimiter.consume(`${route}:${request.ip}`);
}

function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clearOAuthStateCookie(config: AdminAuthConfig): string {
  return serializeCookie(config.oauthCookieName, "", {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

function createCsrfCookie(config: AdminAuthConfig, csrfToken: string): string {
  return serializeCookie(config.csrfCookieName, csrfToken, {
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: config.sessionTtlSeconds,
  });
}

async function auditLoginFailure(store: TraceStore, reason: string): Promise<void> {
  await store.createAuditLog({
    action: "auth.login_failure",
    createdAt: new Date().toISOString(),
    metadata: { reason },
  });
}
