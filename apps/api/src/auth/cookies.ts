import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "None" | "Strict";
  path?: string;
  maxAge?: number;
}

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) continue;

    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);

  return parts.join("; ");
}

export function signValue(value: string, secret: string): string {
  const encodedValue = Buffer.from(value, "utf8").toString("base64url");
  return `${encodedValue}.${sign(encodedValue, secret)}`;
}

export function verifySignedValue(signedValue: string, secret: string): string | undefined {
  const [encodedValue, signature, ...extraParts] = signedValue.split(".");
  if (!encodedValue || !signature || extraParts.length > 0) return undefined;

  const expectedSignature = sign(encodedValue, secret);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
  if (signatureBuffer.length !== expectedSignatureBuffer.length || !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return undefined;
  }

  return Buffer.from(encodedValue, "base64url").toString("utf8");
}

export function hashSecret(value: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
