# Managed Secret Rotation

This documents the rotation procedure for every secret currently consumed by
CI/deployment (see `.github/workflows/staging-deploy.yml`, `backup.yml`,
`restore-drill.yml`) and the GitHub Actions repo/environment secrets store.
It is paired with `.github/workflows/secret-rotation-reminder.yml`, which
opens a quarterly tracking issue so rotation doesn't get forgotten.

There is no secrets-manager (Vault/AWS Secrets Manager/etc.) wired into this
repo today — secrets live directly in GitHub Actions repo/environment
secrets. This doc and the reminder workflow are the rotation *process* on
top of that; they do not (and cannot, from CI) rotate third-party
credentials automatically, since that requires calling each provider's
dashboard/API with owner-level credentials this repo does not hold.

## Inventory & rotation steps

| Secret | Used by | Rotation procedure |
|---|---|---|
| `STAGING_NEXTAUTH_SECRET` | staging-deploy.yml | Generate a new random 32+ byte value (`openssl rand -base64 32`), update in repo/environment secrets. Rotating invalidates all existing staging sessions — acceptable on staging. |
| `STAGING_DATABASE_URL`, `DATABASE_URL` | staging-deploy.yml, backup.yml, restore-drill.yml | Rotate the DB user's password at the provider, then update the connection string secret. Do this during low-traffic hours; existing connections drop until app restart picks up the new URL. |
| `STELLAR_TESTNET_SECRET_KEY`, `STELLAR_SERVER_SECRET_KEY` | staging-deploy.yml (contract deploy), faucet | Generate a new Stellar keypair, fund it (testnet: Friendbot; mainnet: transfer from treasury), update the secret, then re-point the contract's admin/server role to the new public key on-chain before rotating out the old key. |
| `STAGING_PAYSTACK_SECRET_KEY` | staging-deploy.yml | Roll the key in the Paystack dashboard (Settings → API Keys → Roll Key), update the secret immediately — Paystack invalidates the old key on roll. |
| `STAGING_TERMII_API_KEY` | staging-deploy.yml | Regenerate in the Termii dashboard, update secret, revoke the old key once confirmed working. |
| `STAGING_REDIS_URL` | staging-deploy.yml | Rotate the Redis auth password/ACL user at the provider, update the secret. |
| `STAGING_CRON_SECRET`, `CRON_SECRET` | staging-deploy.yml, load-test.yml | Internal shared secret used to authorize cron endpoints — generate a new random value and update; no external dependency. |
| `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | staging-deploy.yml | Regenerate the auth token in Sentry (Settings → Auth Tokens); the DSN itself rarely needs rotation unless leaked — if leaked, regenerate the project's client key in Sentry. |
| `VERCEL_TOKEN` | staging-deploy.yml, pr-preview.yml | Revoke and regenerate in Vercel (Account Settings → Tokens), update secret. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | backup.yml, restore-drill.yml | Create a new access key for the IAM user/role, update the secret, verify a manual `workflow_dispatch` run of `restore-drill.yml` succeeds, then deactivate/delete the old key. |
| `SLACK_WEBHOOK_URL` | uptime.yml, backup.yml, restore-drill.yml, load-test.yml | Regenerate the incoming webhook in the Slack app config, update secret, delete the old webhook. |

## General rule

1. Never let old and new credentials overlap by more than the time needed to
   confirm the new one works (one CI run / one manual smoke test).
2. Prefer providers that support "roll without downtime" (Paystack, Stripe,
   Vercel tokens) — rotate those most often since it's low-cost.
3. Any secret that appears in a Gitleaks/TruffleHog finding (see
   `SECRETS_SCANNING.md`) must be rotated immediately, not just removed from
   git history.
4. After rotating, confirm the dependent workflow actually ran green before
   closing out the rotation (staging-deploy for app secrets,
   restore-drill for AWS/DB backup secrets, uptime for Slack webhook).
