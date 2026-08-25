const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface VerifyCsrfRequestInput {
  method: string;
  origin: string | undefined;
  referer: string | undefined;
  adminAppOrigin: string;
  csrfCookie: string | undefined;
  csrfHeader: string | undefined;
}

export function verifyCsrfRequest(
  input: VerifyCsrfRequestInput,
): { ok: true } | { ok: false; statusCode: 403; error: string } {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };

  const requestOrigin = input.origin ?? originFromReferer(input.referer);
  if (requestOrigin !== input.adminAppOrigin) {
    return { ok: false, statusCode: 403, error: "csrf_origin_invalid" };
  }

  if (!input.csrfCookie || input.csrfHeader !== input.csrfCookie) {
    return { ok: false, statusCode: 403, error: "csrf_token_invalid" };
  }

  return { ok: true };
}

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
