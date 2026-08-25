import { describe, expect, it } from "vitest";
import { hashSecret, parseCookieHeader, serializeCookie, signValue, verifySignedValue } from "./cookies.js";

describe("cookie helpers", () => {
  it("serializes HttpOnly SameSite Lax Secure cookies", () => {
    const cookie = serializeCookie("__trace_admin_session", "abc", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60,
    });

    expect(cookie).toContain("__trace_admin_session=abc");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=60");
  });

  it("verifies signed values and rejects tampering", () => {
    const signed = signValue("raw_session", "0123456789abcdef0123456789abcdef");

    expect(verifySignedValue(signed, "0123456789abcdef0123456789abcdef")).toBe("raw_session");
    expect(verifySignedValue(`${signed}x`, "0123456789abcdef0123456789abcdef")).toBeUndefined();
  });

  it("parses repeated cookie headers with the last value winning", () => {
    expect(parseCookieHeader("a=1; b=two%20words; a=2").get("a")).toBe("2");
    expect(parseCookieHeader("a=1; b=two%20words").get("b")).toBe("two words");
  });

  it("hashes secrets without returning the raw value", () => {
    const hash = hashSecret("raw_session", "0123456789abcdef0123456789abcdef");
    expect(hash).not.toContain("raw_session");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
