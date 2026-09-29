/**
 * SSRF protection for outbound HTTP requests (#105).
 *
 * Every server-side request whose destination comes from configuration (Soroban RPC, KYC
 * provider, faucet) goes through {@link safeFetch}, which refuses to talk to internal
 * infrastructure: loopback, private and link-local ranges (including the cloud metadata
 * address 169.254.169.254), non-HTTP(S) schemes, URLs with embedded credentials, and
 * hostnames that resolve to any of those. Redirects are never followed, because a redirect
 * from an allowed host is the classic way around a check made on the first URL.
 *
 * Private destinations are allowed outside production (local Stellar quickstart, test
 * servers) and can be enabled explicitly with `OUTBOUND_ALLOW_PRIVATE_NETWORK=true`.
 *
 * Known limit: the hostname is resolved for validation and again by `fetch`, so a DNS
 * rebinding server could answer differently the second time. Pin production endpoints with
 * `allowedHosts` when the destination is fixed.
 */
import { lookup } from "dns/promises";
import { isIP } from "net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export interface OutboundPolicy {
  /** Exact (lowercase) hostnames that may be contacted. Anything else is rejected. */
  allowedHosts?: string[];
  /** Permit plain `http:`. Off by default. */
  allowHttp?: boolean;
  /** Permit loopback / private / link-local destinations. Off by default. */
  allowPrivateNetwork?: boolean;
  /** Resolve a hostname to its IP addresses. Injectable for tests. */
  resolve?: (hostname: string) => Promise<string[]>;
}

/** Default policy: private destinations and http only outside production, or by explicit opt-in. */
export function defaultOutboundPolicy(
  env: Record<string, string | undefined> = process.env
): OutboundPolicy {
  const allowPrivateNetwork =
    env.NODE_ENV !== "production" || env.OUTBOUND_ALLOW_PRIVATE_NETWORK === "true";
  return { allowPrivateNetwork, allowHttp: allowPrivateNetwork };
}

/** The default policy with `extra` applied on top, e.g. a fixed `allowedHosts` for one vendor. */
export function outboundPolicy(extra: Partial<OutboundPolicy>): OutboundPolicy {
  return { ...defaultOutboundPolicy(), ...extra };
}

// ── IP classification ─────────────────────────────────────────────────────────

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

/** Expand an IPv6 address into its eight 16-bit groups, or null if malformed. */
function parseIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1) counts as two groups.
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    addr =
      addr.slice(0, lastColon + 1) +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ":" +
      ((v4[2] << 8) | v4[3]).toString(16);
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function isPrivateIPv4(o: number[]): boolean {
  const [a, b, c] = o;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for any address a server-side request must not reach: loopback, private, link-local, etc. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateIPv4(v4);

  const g = parseIPv6(ip);
  if (!g) return true; // unparseable: fail closed

  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded IPv4.
  const embedded = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPrivateIPv4(embedded);
  }
  // NAT64 (64:ff9b::/96) embeds an IPv4 address the same way.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4(embedded);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

// ── URL validation ────────────────────────────────────────────────────────────

const INTERNAL_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];

function isInternalHostname(host: string): boolean {
  return host === "localhost" || INTERNAL_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/**
 * Validate `rawUrl` as a safe outbound destination and return the parsed URL.
 * Throws {@link SsrfError} when it is not.
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  policy: OutboundPolicy = defaultOutboundPolicy()
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Outbound URL is not a valid URL");
  }

  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:")) {
    throw new SsrfError(`Outbound URL scheme '${url.protocol}' is not allowed`);
  }
  if (url.username || url.password) {
    throw new SsrfError("Outbound URL must not contain credentials");
  }

  // The WHATWG parser has already normalised decimal/hex/octal IPv4 forms to dotted quads.
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host) throw new SsrfError("Outbound URL has no host");

  if (policy.allowedHosts && !policy.allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new SsrfError(`Outbound host '${host}' is not on the allow list`);
  }
  if (policy.allowPrivateNetwork) return url;

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new SsrfError(`Outbound address '${host}' is not allowed`);
    return url;
  }
  if (isInternalHostname(host)) throw new SsrfError(`Outbound host '${host}' is not allowed`);

  let addresses: string[];
  try {
    addresses = await (policy.resolve ?? defaultResolve)(host);
  } catch {
    throw new SsrfError(`Outbound host '${host}' could not be resolved`);
  }
  if (addresses.length === 0) throw new SsrfError(`Outbound host '${host}' could not be resolved`);
  // One private answer is enough to reject: the resolver may hand it to fetch.
  if (addresses.some(isPrivateAddress)) {
    throw new SsrfError(`Outbound host '${host}' resolves to a private address`);
  }
  return url;
}

/**
 * `fetch` guarded by {@link assertSafeOutboundUrl}. Redirects are not followed; a 3xx answer
 * is treated as an error instead of being trusted.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  policy: OutboundPolicy = defaultOutboundPolicy()
): Promise<Response> {
  const url = await assertSafeOutboundUrl(rawUrl, policy);
  const response = await fetch(url.toString(), { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new SsrfError(
      `Outbound request to '${url.hostname}' was redirected; redirects are not followed`
    );
  }
  return response;
}
