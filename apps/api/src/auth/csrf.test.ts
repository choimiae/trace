import { describe, expect, it } from "vitest";
import { verifyCsrfRequest } from "./csrf.js";

describe("csrf", () => {
  it("allows safe methods from the admin origin", () => {
    expect(verifyCsrfRequest({
      method: "GET",
      origin: "http://localhost:5173",
      referer: undefined,
      adminAppOrigin: "http://localhost:5173",
      csrfCookie: undefined,
      csrfHeader: undefined,
    })).toEqual({ ok: true });
  });

  it("rejects unsafe methods without matching Origin and CSRF token", () => {
    expect(verifyCsrfRequest({
      method: "POST",
      origin: "http://evil.example",
      referer: undefined,
      adminAppOrigin: "http://localhost:5173",
      csrfCookie: "token",
      csrfHeader: "token",
    })).toMatchObject({ ok: false, statusCode: 403 });
  });
});
