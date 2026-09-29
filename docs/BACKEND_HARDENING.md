# Backend hardening: rate limits, session revocation, streaming exports, idempotency

## Route-specific rate limits (#36)
`withRouteRateLimit(handler, { getUserId })` in `src/server/middleware` resolves a policy from
`src/lib/rate-limit-policies.ts` (first match on method + path wins, otherwise `default`).
Policies are keyed by IP or user. Auth, payment and export policies **fail closed** (503) if
Redis is unavailable, and the rest fail open. Responses include `X-RateLimit-Limit/Remaining/Reset/Policy`, and
429s add `Retry-After`.

## Session revocation (#37)
`revokeSession`, `revokeAllOtherSessions` and `revokeAllSessions` delete the DB rows and add the
token hashes to a Redis denylist (`session:revoked:<hash>`, 30d TTL). `withSessionRevocationCheck`
rejects revoked JWTs with `401 SESSION_REVOKED`. If Redis is down it falls back to the sessions table.

## Secure streaming exports (#39)
`src/lib/streaming-export.ts`: `createCsvStream` streams rows from an async iterator (backpressure
via `pull`), caps rows (`MAX_EXPORT_ROWS`), neutralises CSV formula injection, and aborts cleanly on
source errors or client cancel. `exportResponseHeaders` sets `no-store`, `nosniff` and a sanitised
attachment filename. Exports are rate limited by the `exports` policy.

## Mutation idempotency (#40)
`withIdempotency(handler, { required })` accepts `Idempotency-Key` (or legacy `X-Idempotency-Key`)
on POST/PUT/PATCH/DELETE. The key must be 8-128 chars `[A-Za-z0-9_-:]`. Key reuse with a different body
returns `422`, and a duplicate sent while the first request is still running returns `409`. 5xx responses are not
cached, so retries run again. Replays carry `Idempotent-Replayed: true`.
