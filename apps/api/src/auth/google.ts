import { createHash, randomBytes } from "node:crypto";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { AdminAuthConfig } from "./config.js";
import { parseCookieHeader, serializeCookie, signValue, verifySignedValue } from "./cookies.js";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const OAUTH_STATE_TTL_SECONDS = 600;

interface OAuthStateCookieInput {
  config: AdminAuthConfig;
  now?: Date;
}

interface ReadOAuthStateCookieInput extends OAuthStateCookieInput {
  cookieHeader: string | undefined;
}

interface OAuthState {
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: true;
  name?: string;
  pictureUrl?: string;
}

export interface GoogleOAuthClient {
  getAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): URL;
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<{ idToken: string }>;
  verifyIdToken(input: { idToken: string; nonce: string }): Promise<GoogleProfile>;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function createOAuthStateCookie(input: OAuthStateCookieInput): {
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAtMs: number;
  cookie: string;
} {
  const now = input.now ?? new Date();
  const state: OAuthState = {
    state: createOAuthNonce(),
    nonce: createOAuthNonce(),
    codeVerifier: createPkcePair().verifier,
    expiresAt: now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000,
  };

  return {
    state: state.state,
    nonce: state.nonce,
    codeVerifier: state.codeVerifier,
    expiresAtMs: state.expiresAt,
    cookie: serializeCookie(input.config.oauthCookieName, signValue(JSON.stringify(state), input.config.sessionSecret), {
      httpOnly: true,
      secure: input.config.cookieSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_SECONDS,
    }),
  };
}

export function readOAuthStateCookie(input: ReadOAuthStateCookieInput): {
  state: string;
  nonce: string;
  codeVerifier: string;
} | undefined {
  const signedState = parseCookieHeader(input.cookieHeader).get(input.config.oauthCookieName);
  if (!signedState) return undefined;

  const value = verifySignedValue(signedState, input.config.sessionSecret);
  if (!value) return undefined;

  try {
    const state = JSON.parse(value) as Partial<OAuthState>;
    if (
      typeof state.state !== "string"
      || typeof state.nonce !== "string"
      || typeof state.codeVerifier !== "string"
      || typeof state.expiresAt !== "number"
      || state.expiresAt <= (input.now ?? new Date()).getTime()
    ) {
      return undefined;
    }

    return { state: state.state, nonce: state.nonce, codeVerifier: state.codeVerifier };
  } catch {
    return undefined;
  }
}

export function createOAuthStateStore(): {
  save(state: string, expiresAtMs: number): void;
  consume(state: string, nowMs?: number): boolean;
  size(): number;
} {
  const states = new Map<string, number>();

  function cleanExpired(nowMs: number): void {
    for (const [state, expiresAtMs] of states) {
      if (expiresAtMs <= nowMs) states.delete(state);
    }
  }

  return {
    save(state, expiresAtMs) {
      cleanExpired(Date.now());
      states.set(state, expiresAtMs);
    },
    consume(state, nowMs = Date.now()) {
      cleanExpired(nowMs);
      if (!states.has(state)) return false;

      states.delete(state);
      return true;
    },
    size() {
      return states.size;
    },
  };
}

export function createGoogleOAuthClient(
  config: AdminAuthConfig,
  fetchFn: typeof fetch = fetch,
  options?: { jwks?: ReturnType<typeof createLocalJWKSet> },
): GoogleOAuthClient {
  const googleConfig = requireGoogleOAuthConfig(config);
  const jwks = options?.jwks ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

  return {
    getAuthorizationUrl(input) {
      const url = new URL(GOOGLE_AUTHORIZATION_URL);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", googleConfig.googleClientId);
      url.searchParams.set("redirect_uri", googleConfig.googleRedirectUri);
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", input.state);
      url.searchParams.set("nonce", input.nonce);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url;
    },

    async exchangeCode(input) {
      const response = await fetchFn(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: input.code,
          client_id: googleConfig.googleClientId,
          client_secret: googleConfig.googleClientSecret,
          redirect_uri: googleConfig.googleRedirectUri,
          grant_type: "authorization_code",
          code_verifier: input.codeVerifier,
        }),
      });
      if (!response.ok) throw new Error("Google token exchange failed");

      const body = await response.json() as { id_token?: unknown };
      if (typeof body.id_token !== "string") throw new Error("Google token response missing id_token");
      return { idToken: body.id_token };
    },

    async verifyIdToken(input) {
      const { payload } = await jwtVerify(input.idToken, jwks, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: googleConfig.googleClientId,
        requiredClaims: ["exp"],
      });
      if (payload.nonce !== input.nonce) throw new Error("Google ID token nonce mismatch");
      if (payload.email_verified !== true) throw new Error("Google ID token email_verified claim is required");
      if (typeof payload.email !== "string") throw new Error("Google ID token email claim is required");
      if (config.googleAllowedDomain && payload.hd !== config.googleAllowedDomain) {
        throw new Error("Google ID token hosted domain is not allowed");
      }

      const email = payload.email.toLowerCase();
      if (!config.allowedEmails.has(email)) throw new Error("Google account email is not allowed");
      if (typeof payload.sub !== "string") throw new Error("Google ID token subject claim is required");

      return {
        sub: payload.sub,
        email,
        emailVerified: true,
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
        ...(typeof payload.picture === "string" ? { pictureUrl: payload.picture } : {}),
      };
    },
  };
}

function requireGoogleOAuthConfig(config: AdminAuthConfig): {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
} {
  if (!config.googleClientId || !config.googleClientSecret || !config.googleRedirectUri) {
    throw new Error("Google OAuth configuration is not enabled");
  }

  return {
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    googleRedirectUri: config.googleRedirectUri,
  };
}
