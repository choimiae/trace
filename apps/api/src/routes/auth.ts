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
import type { TraceStore } from "../store/types.js";

export interface AuthMeResponse {
  user: { adminUserId: string; email: string; name?: string; pictureUrl?: string };
  projects: Array<{ projectId: string }>;
  csrfToken: string;
  auth: { googleLogin: boolean; localLogin: boolean };
}

const callbackSchema = z.object({
  code: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  state: z.string().min(1),
}).refine(({ code, error }) => (code === undefined) !== (error === undefined));

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: { store: TraceStore; config: AdminAuthConfig; googleOAuthClient?: GoogleOAuthClient },
) {
  const stateStore = createOAuthStateStore();
  const rateLimiter = createFixedWindowRateLimiter({
    windowMs: options.config.loginRateLimitWindowSeconds * 1000,
    max: options.config.loginRateLimitMax,
  });

  app.get("/auth/login-options", async () => ({
    googleLogin: options.config.googleOAuthEnabled,
    localLogin: options.config.localAdminLoginEnabled,
  }));

  app.get("/auth/google/start", async (request, reply) => {
    if (!options.config.googleOAuthEnabled || !options.googleOAuthClient) {
      return reply.code(404).send({ error: "google_login_disabled" });
    }

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
    if (!options.config.googleOAuthEnabled || !options.googleOAuthClient) {
      return reply.code(404).send({ error: "google_login_disabled" });
    }

    if (!consumeLoginRateLimit(rateLimiter, request, "callback")) {
      return reply.code(429).send({ error: "login_rate_limited" });
    }

    const callback = callbackSchema.safeParse(request.query);
    const oauthState = callback.success
      ? readOAuthStateCookie({ config: options.config, cookieHeader: request.headers.cookie })
      : undefined;

    if (!callback.success || !oauthState || oauthState.state !== callback.data.state || !stateStore.consume(callback.data.state)) {
      return reply.code(401).send({ error: "oauth_state_invalid" });
    }

    const clearedOauthCookie = clearOAuthStateCookie(options.config);
    if (callback.data.error) {
      return reply.header("set-cookie", clearedOauthCookie).code(401).send({ error: "oauth_denied" });
    }

    try {
      const token = await options.googleOAuthClient.exchangeCode({
        code: callback.data.code!,
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

      return reply
        .header("set-cookie", [clearedOauthCookie, session.cookie, session.csrfCookie])
        .redirect(options.config.adminAppOrigin);
    } catch {
      return reply.header("set-cookie", clearedOauthCookie).code(401).send({ error: "oauth_token_invalid" });
    }
  });

  app.get("/auth/local/start", async (_request, reply) => {
    if (!options.config.localAdminLoginEnabled) {
      return reply.code(404).send({ error: "local_login_disabled" });
    }

    const email = options.config.allowedEmails.values().next().value;
    if (!email) return reply.code(401).send({ error: "admin_auth_required" });

    const now = new Date().toISOString();
    const user = await options.store.upsertAdminUserFromGoogle({
      googleSub: `local:${email}`,
      email,
      emailVerified: true,
      name: "Local Admin",
      now,
    });
    const session = await createAdminSessionForUser({ store: options.store, config: options.config, user });

    return reply
      .header("set-cookie", [session.cookie, session.csrfCookie])
      .redirect(options.config.adminAppOrigin);
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
    const projects = await options.store.listProjects();

    return {
      user: {
        adminUserId: user.adminUserId,
        email: user.email,
        ...(user.name ? { name: user.name } : {}),
        ...(user.pictureUrl ? { pictureUrl: user.pictureUrl } : {}),
      },
      projects: projects.map(({ projectId }) => ({ projectId })),
      csrfToken,
      auth: {
        googleLogin: options.config.googleOAuthEnabled,
        localLogin: options.config.localAdminLoginEnabled,
      },
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
