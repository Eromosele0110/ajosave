# Security controls: CSRF, SSRF, OTP abuse, export deletion

Covers issues #104 (CSRF mutation protection), #105 (SSRF outbound validation), #109 (OTP abuse
controls) and #110 (secure exports deletion). Every control below has automated tests that run in
the `Unit Tests` CI job (`npm test -- --coverage`).

## CSRF mutation protection (#104)

Code: `src/lib/csrf.ts`, enforced in `src/middleware.ts` for every `/api/*` request.

The API accepts bearer tokens (`Authorization` header — a browser never attaches these on its own)
and cookies (the refresh-token cookie and the NextAuth session cookie — a browser attaches these to
any request, including cross-site ones). Only cookies can be abused by another site, so:

| Request | Result |
|---|---|
| `GET` / `HEAD` / `OPTIONS` | Not checked (safe methods). |
| Carries `Authorization` | Not checked. |
| Carries no cookie | Not checked (no ambient credentials to abuse). |
| Webhooks (`/api/**/webhooks/*`, `/api/**/kyc/webhook`) and NextAuth built-ins (`callback`, `signin`, `signout`, `session`, `csrf`, `providers`, `error`) | Exempt: they authenticate by signature or NextAuth's own CSRF token. |
| `POST`/`PUT`/`PATCH`/`DELETE` with a cookie | Must prove where it came from (below), else `403 {"error":"CSRF validation failed"}`. |

Proof of origin, in order: the `Origin` header; else the origin of `Referer`; else, if a browser sent
neither, `Sec-Fetch-Site: same-origin`. The origin must equal the request's own origin or be in the
allow list (`ALLOWED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`, plus the production hosts). The
opaque origin `null` is never accepted, and `Sec-Fetch-Site` never overrides a mismatched `Origin`.

`SameSite=Lax` on the refresh-token cookie stays as defence in depth. It does not stop same-site
attackers or older browsers, which is why the origin check exists.

Operations: a blocked request logs `[csrf] blocked <METHOD> <path>: <reason>` where `<reason>` is
`origin-mismatch` or `missing-origin`. A burst of `missing-origin` from a legitimate client usually
means a non-browser client is sending cookies without an `Origin`; give it a bearer token instead.

## SSRF outbound validation (#105)

Code: `src/lib/ssrf.ts`. All server-side requests whose destination is configuration-driven use
`safeFetch`: Soroban RPC (`STELLAR_SOROBAN_RPC_URL`), the KYC provider, and the testnet faucet.

`assertSafeOutboundUrl` rejects:

- schemes other than `https:` (`http:` only outside production);
- URLs with embedded credentials;
- loopback, private, link-local (including the cloud metadata address `169.254.169.254`),
  carrier-grade NAT, multicast and reserved IPv4 and IPv6 ranges, including IPv4-mapped and NAT64
  IPv6 forms and alternative IPv4 spellings (`2130706433`, `0x7f000001`, `127.1`);
- internal hostnames (`localhost`, `*.local`, `*.internal`, `*.localhost`, `*.home.arpa`);
- hostnames that resolve to any private address (one bad answer is enough), or do not resolve;
- with `allowedHosts` set, any host not on the list. Fixed vendors (Smile Identity, Friendbot) are
  pinned this way.

`safeFetch` never follows redirects; a 3xx response is an error. The Termii, Paystack and FX axios
clients use `maxRedirects: 0` for the same reason.

Private destinations are allowed outside production (local Stellar quickstart, test servers). In
production set `OUTBOUND_ALLOW_PRIVATE_NETWORK=true` only for a private RPC you operate.

Known limit: DNS is resolved once to validate and again by `fetch`, so a DNS-rebinding server could
answer differently the second time. Prefer `allowedHosts` for fixed destinations.

Operations: a blocked request throws `SsrfError` with the reason; it surfaces through the caller's
normal error handling and Sentry.

## OTP abuse controls (#109)

Code: `src/lib/otp-abuse.ts` (send limits) and `src/lib/otp-code.ts` (generation, comparison). Applied
in `POST /api/auth/send-otp` and `POST /api/v1/auth/send-otp`. These sit on top of the existing
per-route rate limit and the verify-side lockout (see `OTP_BRUTE_FORCE_PROTECTION.md`).

Each send must clear, in Redis:

| Limit | Value | Response |
|---|---|---|
| Resend cooldown per phone | 1 OTP / 60 s | `429`, `Retry-After` = remaining cooldown |
| Daily cap per phone | 10 OTPs / 24 h | `429`, `Retry-After` = window remaining |
| Hourly cap per client IP | 20 OTPs / hour (skipped when the IP is unknown) | `429`, `Retry-After` = window remaining |

Other hardening:

- Codes come from `crypto.randomInt`, not `Math.random()`.
- Verification uses a constant-time comparison; a missing or differently-sized code never matches.
- If the SMS provider fails, the cooldown is released so the user can retry immediately.
- Redis errors propagate (fail closed) instead of letting sends through unmetered.
- Denials log `[otp] send denied` with the reason; phone numbers are masked (`+234*******678`).

Redis keys: `otp_cooldown:<phone>`, `otp_daily:<phone>`, `otp_ip:<ip>` (plus the existing `otp:`,
`otp_failures:` and `lockout:` keys).

## Export deletion (#110)

Exports (`/api/user/contributions/export`, `/api/admin/analytics/export`) are generated on demand and
streamed straight to the caller: nothing is written to disk or object storage, so there is no export
artifact to expire or delete. What must be secured is the copy that lands on the client and what
survives account deletion:

- Both routes use `createCsvStream` and `exportResponseHeaders` (`src/lib/streaming-export.ts`):
  `Cache-Control: no-store, private`, `Pragma: no-cache`, `Expires: 0`, `nosniff`, a sandboxing CSP,
  a sanitised filename, a row cap, and CSV formula-injection neutralisation. The user export
  previously lacked all of these.
- The user export joins `users` on `deleted_at IS NULL`, so a deleted account exports nothing even if
  a stale session is presented.
- `deleteUserData` (`src/server/services/user-deletion.service.ts`) now also revokes every session and
  denylists the issued JWTs, and purges the phone-keyed Redis state (`otp:`, `lockout:`,
  `otp_failures:`, `otp_cooldown:`, `otp_daily:`). This cleanup is best-effort and logged: the PII
  is already anonymised by then and a cache failure must not make the deletion appear to fail.
- Financial records and `audit_logs` stay, anonymised, as required for regulatory retention.
