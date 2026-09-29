# Metrics Alerting

Ajosave already collects the two kinds of "metrics" that matter operationally
— uptime/health (`uptime.yml`) and error events (Sentry, via
`sentry.client.config.ts`/`sentry.server.config.ts`/`sentry.edge.config.ts`)
— but alerting was only wired up for uptime. This documents the current
state and what was added.

## Alerting that existed already

- `.github/workflows/uptime.yml` pings `/api/health` every 5 minutes and
  posts to `SLACK_WEBHOOK_URL` on failure.

## Alerting added by this change

The same Slack-webhook pattern uptime.yml already used is now applied to
the other scheduled/CI jobs that previously only logged a CI annotation on
failure, so a failure doesn't require someone to be watching the Actions
tab:

- `.github/workflows/backup.yml` — Slack alert if the nightly PostgreSQL
  backup fails.
- `.github/workflows/restore-drill.yml` — Slack alert if the weekly restore
  drill fails (i.e. the latest backup would not actually restore).
- `.github/workflows/load-test.yml` — Slack alert if the k6 payout load
  test breaches its `http_req_duration p(95) < 5000ms` or
  `payout_error_rate < 10%` thresholds on a scheduled/push run (not on PR
  runs, where the failing check on the PR itself is the signal).

All four now alert through the same `SLACK_WEBHOOK_URL` secret, so there is
one channel to configure/rotate (see `docs/SECRET_ROTATION.md`) rather than
one-off webhooks per workflow.

## Sentry alert rules (not code-configurable from this repo)

Sentry is already collecting errors from all three runtimes
(client/server/edge configs). Sentry's *alert rules* (e.g. "notify on N
errors in M minutes", "notify on a new issue type") are configured in the
Sentry project dashboard, not in this repo — this fork does not have
Sentry org/project owner access to configure them. What CI can verify is
that error reporting itself is wired up (the existing
`SENTRY_DSN`/`SENTRY_AUTH_TOKEN` secrets used at build time in
`staging-deploy.yml`).

**Action for a repo/Sentry admin:** in Sentry → Alerts, add a rule such as
"more than 10 events in 5 minutes" or "new issue in production
environment" and point it at the same Slack workspace the
`SLACK_WEBHOOK_URL` webhook belongs to, so all alerting lands in one place.
