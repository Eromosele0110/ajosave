# Incident Response Runbook

This covers application-level incidents (outages, degraded service, broken
user journeys) — how they're detected, how to triage them, and where to
look first. It complements, and does not replace:

- **`MAINNET_RUNBOOK.md`** — Soroban contract deployment/upgrade/rollback
  procedures on Stellar mainnet.
- **`SECURITY.md`** — how to report and handle a security vulnerability.
- **`docs/backup.md`** — database backup and restore procedure.

## How we find out

| Signal | Where it comes from | What it means |
|---|---|---|
| `:red_circle: Ajosave is DOWN` in Slack | `.github/workflows/uptime.yml` → *Health Check* job, every 5 min | `/api/health` returned a non-200 status. The app process is unreachable, crashed, or the deploy is broken. |
| `:warning: Ajosave journey probe failed` in Slack | `.github/workflows/uptime.yml` → *Synthetic Journey Probe* job, every 5 min | The app is up but a real user flow is broken: `/api/v1/health` (DB/Redis reachability), browsing open circles (`/api/v1/circles`), or the FX rate quote (`/api/fx/rate`) failed. The failed step is named in the alert. |
| Weekly restore-drill failure | `.github/workflows/restore-drill.yml` | The latest backup could not be restored or failed its sanity check — a *backup* incident, not necessarily a live-service incident, but treat as urgent (it means we currently have no verified recovery point). |
| Sentry error spike | `sentry.server.config.ts` / `sentry.client.config.ts` | Runtime exceptions in production, may precede or accompany an uptime/journey alert. |
| User/support report | Manual | Anything not caught by the above — always worth cross-checking against `/api/health` and recent deploys regardless. |

## Severity

- **SEV1** — App fully down, or funds/payment flows broken (contributions,
  payouts, USDC conversion) for all users. Page immediately, work until
  resolved or handed off.
- **SEV2** — A journey probe step is broken, or a subset of users/flows
  are affected (e.g. KYC callback failing, SMS/OTP provider down). Fix
  during business hours unless it's blocking payouts.
- **SEV3** — Degraded but non-blocking (elevated latency, a non-critical
  background job like the event indexer stalling). Track and fix, no page.

## First 10 minutes

1. **Acknowledge** the Slack alert so others know it's being worked.
2. **Confirm it's real**, not a transient blip:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$NEXT_PUBLIC_APP_URL/api/health"
   curl -s "$NEXT_PUBLIC_APP_URL/api/v1/health" | jq .
   ```
   `/api/v1/health` breaks the check down by dependency (`db`, `redis`) —
   start there to narrow down what's actually failing.
3. **Check recent changes** — a new deploy is the most common cause:
   ```bash
   gh run list --workflow=staging-deploy.yml --limit 5
   gh api repos/joekeyz8/ajosave/commits?sha=main --jq '.[0:5][] | {sha:.sha[0:7], msg:.commit.message}'
   ```
4. **Check Sentry** for a correlated error spike at the same timestamp.
5. Decide: roll back the deploy, or fix forward. When in doubt, **roll
   back first, investigate after** — see below.

## Common failure modes

### `/api/health` failing (app unreachable / SEV1)

- Most likely a bad deploy or the app failed to boot. Since `instrumentation.ts`
  runs DB migrations and starts background services (Horizon stream, event
  indexer) at boot in production, a broken migration or an unhandled
  startup exception will take the whole app down — check deploy logs for
  a migration or `initializeServices()` failure first.
- Roll back to the previous deployment (see the platform's rollback/redeploy
  action for the hosting target in use) rather than debugging forward under
  a SEV1.

### Journey probe: `health` step failing but `/api/health` is fine

- `/api/v1/health` checks Postgres (`SELECT 1`) and Redis (`PING`)
  independently — the alert body / `jq .` output on that endpoint tells
  you which one. A DB failure here but not on `/api/health` usually means
  connection pool exhaustion (`DB_POOL_SIZE`, see
  `docs/environment-variables.md`) rather than the DB being fully down.

### Journey probe: `browse circles` step failing

- The public circle listing hits the DB through
  `src/server/services/circle.service.ts` and the cursor-pagination helper
  in `src/lib/pagination.ts`. Check for a bad migration or a recent change
  to that query path.

### Journey probe: `fx rate` step failing

- `src/lib/fx.ts` calls an external FX rate provider. A failure here is
  often the upstream provider being down/rate-limiting, not our own
  infra — check whether the provider has a status page before assuming
  an internal bug.

### Payments / payouts affected

- Treat as SEV1 regardless of what the uptime/journey probes say — they
  don't currently cover authenticated flows (contribution, payout,
  Paystack webhook). Check `docs/payout-queries-reference.md` and
  `docs/transactional-outbox.md` (payout/notification delivery goes
  through the outbox — a stuck outbox row means a payout notification
  was queued but not delivered, not necessarily that the payout itself
  failed).

### Backup restore drill failed

- Not a live incident, but fix same-day: rerun
  `gh workflow run restore-drill.yml`, and if it fails again, follow
  `docs/backup.md` to manually verify the latest S3 backup exists and is
  restorable. Until it's green again, treat backups as unverified.

## Escalation / comms

- For a SEV1, post an update in the incident Slack channel at least every
  30 minutes even if there's no new information ("still investigating,
  suspect X").
- If a security angle is suspected (unauthorized access, data exposure),
  stop and follow `SECURITY.md` instead — do not discuss details in a
  public channel.

## After the incident

- Once resolved, confirm both uptime workflow jobs are green:
  `gh run list --workflow=uptime.yml --limit 2`.
- Write a short postmortem: what broke, what the first signal was
  (health check vs. journey probe vs. user report), time to detect, time
  to resolve, and one concrete follow-up (e.g. "add a journey probe step
  for X" or "alert on Y before it becomes a full outage").
