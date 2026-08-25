import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  createGoogleOAuthClient,
  createOAuthStateCookie,
  createOAuthStateStore,
  createPkcePair,
  readOAuthStateCookie,
} from "./google.js";
import type { AdminAuthConfig } from "./config.js";

const config: AdminAuthConfig = {
  googleClientId: "client.apps.googleusercontent.com",
  googleClientSecret: "client_secret",
  googleRedirectUri: "http://localhost:4000/auth/google/callback",
  adminAppOrigin: "http://localhost:5173",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  cookieSecure: false,
  allowedEmails: new Set(["admin@example.com"]),
  sessionTtlSeconds: 28800,
  loginRateLimitWindowSeconds: 300,
  loginRateLimitMax: 20,
  oauthCookieName: "__trace_oauth",
  sessionCookieName: "__trace_admin_session",
  csrfCookieName: "__trace_csrf",
};

describe("google oauth", () => {
  it("builds an authorization URL with state nonce PKCE and OIDC scopes", () => {
    const client = createGoogleOAuthClient(config);
    const url = client.getAuthorizationUrl({ state: "state_1", nonce: "nonce_1", codeChallenge: "challenge_1" });

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(config.googleClientId);
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.searchParams.get("state")).toBe("state_1");
    expect(url.searchParams.get("nonce")).toBe("nonce_1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("round-trips signed one-time OAuth state cookie content", () => {
    const created = createOAuthStateCookie({ config, now: new Date("2026-08-25T00:00:00.000Z") });
    const parsed = readOAuthStateCookie({
      config,
      cookieHeader: created.cookie.split(";")[0],
      now: new Date("2026-08-25T00:05:00.000Z"),
    });

    expect(parsed?.state).toBe(created.state);
    expect(parsed?.nonce).toBe(created.nonce);
    expect(parsed?.codeVerifier).toBe(created.codeVerifier);
  });

  it("rejects a tampered OAuth state cookie", () => {
    const created = createOAuthStateCookie({ config, now: new Date("2026-08-25T00:00:00.000Z") });

    expect(readOAuthStateCookie({
      config,
      cookieHeader: `${created.cookie.split(";")[0]}tampered`,
      now: new Date("2026-08-25T00:05:00.000Z"),
    })).toBeUndefined();
  });

  it("rejects an expired OAuth state cookie", () => {
    const created = createOAuthStateCookie({ config, now: new Date("2026-08-25T00:00:00.000Z") });

    expect(readOAuthStateCookie({
      config,
      cookieHeader: created.cookie.split(";")[0],
      now: new Date(created.expiresAtMs),
    })).toBeUndefined();
  });

  it("does not consume cookie state when callback state differs", () => {
    const created = createOAuthStateCookie({ config, now: new Date("2026-08-25T00:00:00.000Z") });
    const parsed = readOAuthStateCookie({
      config,
      cookieHeader: created.cookie.split(";")[0],
      now: new Date("2026-08-25T00:05:00.000Z"),
    });
    const store = createOAuthStateStore();
    const now = new Date("2026-08-25T00:05:00.000Z").getTime();
    const callbackState = "callback_state_mismatch";
    store.save(created.state, created.expiresAtMs);

    expect(parsed?.state).not.toBe(callbackState);
    expect(store.consume(callbackState, now)).toBe(false);
    expect(store.consume(parsed!.state, now)).toBe(true);
    expect(store.consume(parsed!.state, now)).toBe(false);
  });

  it("consumes matching callback state only once", () => {
    const created = createOAuthStateCookie({ config, now: new Date("2026-08-25T00:00:00.000Z") });
    const parsed = readOAuthStateCookie({
      config,
      cookieHeader: created.cookie.split(";")[0],
      now: new Date("2026-08-25T00:05:00.000Z"),
    });
    const store = createOAuthStateStore();
    const now = new Date("2026-08-25T00:05:00.000Z").getTime();
    const callbackState = parsed!.state;
    store.save(created.state, created.expiresAtMs);

    expect(parsed?.state).toBe(callbackState);
    expect(store.consume(callbackState, now)).toBe(true);
    expect(store.consume(callbackState, now)).toBe(false);
  });

  it("consumes an unexpired OAuth state only once", () => {
    const store = createOAuthStateStore();
    const now = Date.now();
    store.save("state_1", now + 1_000);

    expect(store.consume("state_1", now)).toBe(true);
    expect(store.size()).toBe(0);
    expect(store.consume("state_1", now)).toBe(false);
  });

  it("rejects expired OAuth state", () => {
    const store = createOAuthStateStore();
    const now = Date.now();
    store.save("state_1", now - 1);

    expect(store.consume("state_1", now)).toBe(false);
  });

  it("cleans expired OAuth state keys while consuming", () => {
    const store = createOAuthStateStore();
    const now = Date.now();
    store.save("active", now + 1_000);
    store.save("expired", now - 1);

    expect(store.consume("missing", now)).toBe(false);
    expect(store.size()).toBe(1);
  });

  it("exchanges an authorization code through Google's token endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: "id.jwt" }),
    });
    const client = createGoogleOAuthClient(config, fetchFn as never);

    await expect(client.exchangeCode({ code: "code_1", codeVerifier: "verifier_1" })).resolves.toEqual({ idToken: "id.jwt" });
    expect(fetchFn.mock.calls.at(0)?.[0]).toBe("https://oauth2.googleapis.com/token");
  });

  it("creates an S256 PKCE challenge", () => {
    const pair = createPkcePair();
    expect(pair.verifier.length).toBeGreaterThan(40);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

async function signedGoogleIdToken(overrides: Record<string, unknown> = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key" }] });
  const now = Math.floor(Date.now() / 1000);
  const { aud, exp, iss, ...claimOverrides } = overrides;
  const idToken = await new SignJWT({
    nonce: "nonce_1",
    email: "admin@example.com",
    email_verified: true,
    name: "Admin",
    picture: "https://example.com/avatar.png",
    ...claimOverrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(String(iss ?? "https://accounts.google.com"))
    .setAudience(String(aud ?? config.googleClientId))
    .setSubject("google_sub_1")
    .setIssuedAt(now)
    .setExpirationTime(Number(exp ?? now + 60))
    .sign(privateKey);

  return { idToken, jwks };
}

describe("Google ID token verification", () => {
  it("verifies ID token claims and normalizes Google profile claims", async () => {
    const { idToken, jwks } = await signedGoogleIdToken();
    const client = createGoogleOAuthClient(config, undefined, { jwks });

    await expect(client.verifyIdToken({ idToken, nonce: "nonce_1" })).resolves.toEqual({
      sub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      name: "Admin",
      pictureUrl: "https://example.com/avatar.png",
    });
  });

  it("rejects wrong nonce, wrong audience, expired tokens, and unverified email", async () => {
    const valid = await signedGoogleIdToken();
    const wrongAudience = await signedGoogleIdToken({ aud: "other-client" });
    const expired = await signedGoogleIdToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const unverified = await signedGoogleIdToken({ email_verified: false });

    await expect(createGoogleOAuthClient(config, undefined, { jwks: valid.jwks }).verifyIdToken({
      idToken: valid.idToken,
      nonce: "wrong_nonce",
    })).rejects.toThrow("nonce");
    await expect(createGoogleOAuthClient(config, undefined, { jwks: wrongAudience.jwks }).verifyIdToken({
      idToken: wrongAudience.idToken,
      nonce: "nonce_1",
    })).rejects.toThrow();
    await expect(createGoogleOAuthClient(config, undefined, { jwks: expired.jwks }).verifyIdToken({
      idToken: expired.idToken,
      nonce: "nonce_1",
    })).rejects.toThrow();
    await expect(createGoogleOAuthClient(config, undefined, { jwks: unverified.jwks }).verifyIdToken({
      idToken: unverified.idToken,
      nonce: "nonce_1",
    })).rejects.toThrow("email_verified");
  });

  it("rejects a token from an untrusted issuer", async () => {
    const { idToken, jwks } = await signedGoogleIdToken({ iss: "https://issuer.example.com" });

    await expect(createGoogleOAuthClient(config, undefined, { jwks }).verifyIdToken({
      idToken,
      nonce: "nonce_1",
    })).rejects.toThrow();
  });

  it("rejects a token without an email claim", async () => {
    const { idToken, jwks } = await signedGoogleIdToken({ email: undefined });

    await expect(createGoogleOAuthClient(config, undefined, { jwks }).verifyIdToken({
      idToken,
      nonce: "nonce_1",
    })).rejects.toThrow("email claim");
  });

  it("rejects a verified email outside the admin allow-list", async () => {
    const { idToken, jwks } = await signedGoogleIdToken({ email: "other@example.com" });

    await expect(createGoogleOAuthClient(config, undefined, { jwks }).verifyIdToken({
      idToken,
      nonce: "nonce_1",
    })).rejects.toThrow("not allowed");
  });

  it("rejects a token outside the configured Google hosted domain", async () => {
    const { idToken, jwks } = await signedGoogleIdToken({ hd: "other.example.com" });
    const domainConfig: AdminAuthConfig = { ...config, googleAllowedDomain: "example.com" };

    await expect(createGoogleOAuthClient(domainConfig, undefined, { jwks }).verifyIdToken({
      idToken,
      nonce: "nonce_1",
    })).rejects.toThrow("hosted domain");
  });
});
