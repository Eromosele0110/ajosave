/**
 * CSRF protection for cookie-authenticated mutations (#104).
 *
 * The API accepts two kinds of credential:
 *  - `Authorization: Bearer …` headers, which a browser never attaches on its own, and
 *  - cookies (the refresh-token cookie and the NextAuth session cookie), which it does.
 *
 * Only the second kind can be abused cross-site, so state-changing requests (anything but
 * GET/HEAD/OPTIONS) that carry a cookie and no bearer token must prove they came from an
 * allowed origin. Proof is the `Origin` header, falling back to the `Referer` origin, and
 * finally Fetch Metadata (`Sec-Fetch-Site: same-origin`) when a browser sends neither.
 * A request with a cookie and no such proof is rejected. `SameSite=Lax` cookies are kept as
 * defence in depth, but they do not stop same-site attackers or older browsers.
 *
 * Requests that carry no cookie have no ambient authority to abuse and are not checked;
 * signature-verified webhooks and NextAuth's own routes (which validate their own CSRF
 * token) are exempt.
 */

export const CSRF_SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** Paths whose callers authenticate some other way (webhook signature, NextAuth CSRF token). */
const CSRF_EXEMPT_PATHS: RegExp[] = [
  /^\/api(\/v1)?\/webhooks\//,
  /^\/api(\/v1)?\/kyc\/webhook\/?$/,
  /^\/api(\/v1)?\/auth\/(callback|signin|signout|session|csrf|providers|error)(\/|$)/,
];

export function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some((re) => re.test(pathname));
}

/** Origins allowed to make credentialed requests: configured ones plus the app's own. */
export function resolveAllowedOrigins(
  env: Record<string, string | undefined> = process.env
): string[] {
  const configured = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",") : [];
  return [
    ...configured,
    env.NEXT_PUBLIC_APP_URL,
    env.NEXTAUTH_URL,
    "http://localhost:3000",
    "https://ajosave.app",
    "https://www.ajosave.app",
  ]
    .filter((o): o is string => Boolean(o))
    .map((o) => o.trim().replace(/\/$/, ""));
}

export interface CsrfCheckInput {
  method: string;
  pathname: string;
  headers: { get(name: string): string | null };
  /** Origin of the URL the request was sent to (`request.nextUrl.origin`). */
  requestOrigin: string;
  allowedOrigins: string[];
}

export type CsrfDecision =
  | { ok: true }
  | { ok: false; reason: "missing-origin" | "origin-mismatch" };

/** The origin that initiated the request: `Origin`, else the `Referer`'s origin, else null. */
export function sourceOrigin(headers: { get(name: string): string | null }): string | null {
  const origin = headers.get("origin");
  if (origin) return origin.trim();
  const referer = headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function checkCsrf(input: CsrfCheckInput): CsrfDecision {
  if (CSRF_SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (isCsrfExempt(input.pathname)) return { ok: true };

  // A bearer token is not ambient: a cross-site page cannot make the browser attach it.
  if (input.headers.get("authorization")) return { ok: true };
  // No cookie, no ambient credentials to ride on.
  if (!input.headers.get("cookie")?.trim()) return { ok: true };

  const source = sourceOrigin(input.headers);
  if (source === null) {
    return input.headers.get("sec-fetch-site") === "same-origin"
      ? { ok: true }
      : { ok: false, reason: "missing-origin" };
  }
  if (source === input.requestOrigin || input.allowedOrigins.includes(source)) return { ok: true };
  return { ok: false, reason: "origin-mismatch" };
}
