/**
 * API deprecation policy (#33).
 *
 * Deprecated endpoints advertise their status via RFC 8594 `Deprecation` /
 * `Sunset` headers plus a `Link` to the successor. After the sunset date the
 * endpoint returns 410 Gone. See docs/API_DEPRECATION_POLICY.md.
 */
import { NextResponse } from "next/server";
import { logger } from "./logger";

export interface DeprecationEntry {
  /** Path prefix, e.g. "/api/v1/legacy-thing". */
  path: string;
  method?: string;
  deprecatedAt: string; // ISO date
  sunsetAt: string; // ISO date, must be >= deprecatedAt + MIN_NOTICE_DAYS
  successor?: string;
}

export const MIN_NOTICE_DAYS = 90;

export const DEPRECATIONS: DeprecationEntry[] = [];

export function validateDeprecation(entry: DeprecationEntry): void {
  const dep = Date.parse(entry.deprecatedAt);
  const sunset = Date.parse(entry.sunsetAt);
  if (Number.isNaN(dep) || Number.isNaN(sunset)) {
    throw new Error(`Invalid dates for deprecation of ${entry.path}`);
  }
  if (sunset - dep < MIN_NOTICE_DAYS * 86_400_000) {
    throw new Error(`Deprecation of ${entry.path} must give at least ${MIN_NOTICE_DAYS} days notice`);
  }
}

export function findDeprecation(
  pathname: string,
  method: string,
  entries: DeprecationEntry[] = DEPRECATIONS,
): DeprecationEntry | undefined {
  return entries.find(
    (e) =>
      (pathname === e.path || pathname.startsWith(e.path + "/")) &&
      (!e.method || e.method.toUpperCase() === method.toUpperCase()),
  );
}

export function isSunset(entry: DeprecationEntry, now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(entry.sunsetAt);
}

export function deprecationHeaders(entry: DeprecationEntry): Record<string, string> {
  const headers: Record<string, string> = {
    Deprecation: `@${Math.floor(Date.parse(entry.deprecatedAt) / 1000)}`,
    Sunset: new Date(entry.sunsetAt).toUTCString(),
  };
  if (entry.successor) headers.Link = `<${entry.successor}>; rel="successor-version"`;
  return headers;
}

/**
 * Returns a 410 response if the endpoint is past sunset, otherwise decorates
 * `response` with deprecation headers. Returns `response` untouched when the
 * endpoint is not deprecated.
 */
export function applyDeprecationPolicy(
  pathname: string,
  method: string,
  response: NextResponse,
  now: Date = new Date(),
  entries: DeprecationEntry[] = DEPRECATIONS,
): NextResponse {
  const entry = findDeprecation(pathname, method, entries);
  if (!entry) return response;

  const headers = deprecationHeaders(entry);
  if (isSunset(entry, now)) {
    logger.warn({ path: pathname, method }, "request to sunset endpoint");
    return NextResponse.json(
      { error: { code: "GONE", message: `${pathname} was removed on ${entry.sunsetAt}` } },
      { status: 410, headers },
    );
  }
  logger.info({ path: pathname, method }, "request to deprecated endpoint");
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}
