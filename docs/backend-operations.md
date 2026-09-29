# Backend operations jobs & probes

## KYC status reconciliation (#42)
`GET /api/v1/cron/kyc-reconcile` (signed cron request). Finds users whose `kyc_status = 'pending'`
for more than 30 minutes (`kyc_submitted_at`), queries Smile Identity `job_status`, and applies final
results. Updates are guarded with `WHERE kyc_status = 'pending'`, so a concurrent webhook always wins.
Provider errors are counted as `failed` and retried on the next run. Suggested schedule: every 15 min.

## Retention deletion (#43)
`GET /api/v1/cron/retention[?dryRun=true]` (signed cron request).

| Table | Column | Retention |
|---|---|---|
| sessions | expires_at | 7 days |
| processed_webhooks | created_at | 30 days |
| sms_logs | created_at | 90 days |
| outbox_events | processed_at (processed only) | 30 days |

Deletes run in batches of 1000, max 50 batches per table per run (`truncated: true` means backlog
remains). Financial tables and `audit_logs` are never purged. Minimum window is 7 days. Suggested schedule: daily.

## Dependency readiness (#44)
`GET /api/health/ready` returns `200 {status:"ready"}` or `503 {status:"not_ready"}`. Checks: required
env (`DATABASE_URL`), database (critical), Redis (non-critical). Each check has a 2s timeout.
Use it as the load-balancer / Kubernetes readiness probe; `/api/health` remains the liveness endpoint.

## Query performance monitoring (#45)
Every `query()` call records latency by normalised SQL (literals stripped — no parameter values or PII
are logged). Queries at or above `DB_SLOW_QUERY_MS` (default 500) log a `[db] slow query` warning.
Admins can read the top statements by total time at `GET /api/v1/admin/query-stats?limit=20`.
Stats are in-memory per instance and reset on restart.
