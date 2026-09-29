# Environment Variable Reference

This is a reference for every environment variable the app actually reads
(via `process.env`), grouped by area. `.env.example` in the repo root has
copy-pasteable defaults for local development.

As of this writing, most server-side variables listed below are also
validated at startup by `src/server/config/env.ts` (typed, with production
defaults enforced) — see that file for the authoritative schema. Variables
marked "not yet in `env.ts`" are read directly via `process.env` at their
call site and are not (yet) covered by that schema.

Legend: **Required** = must be set in production or the app will refuse to
start / the feature will not work. **Optional** = has a safe default.

## App

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Optional | `http://localhost:3000` | Public base URL of the app, used in emails, webhooks, and the uptime workflow. |
| `NEXT_PUBLIC_APP_NAME` | Optional | `STELLAR` | Display name used in UI/emails. |
| `NODE_ENV` | Optional (platform-set) | `development` | Standard Node environment; `production` enables stricter env validation and runs DB migrations on boot (see `instrumentation.ts`). |

## Auth

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXTAUTH_URL` | Optional | `""` | Base URL NextAuth uses for callbacks. Example: `https://ajosave.app`. |
| `NEXTAUTH_SECRET` | **Required in prod** | dev-only fallback | Secret used to sign/encrypt NextAuth session tokens. Generate with `openssl rand -base64 32`. |

## Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Required in prod** | `""` | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/db`. |
| `DB_POOL_SIZE` | Optional | `10` | Max pg pool connections. |
| `DB_POOL_MIN` | Optional | `2` | Min pg pool connections. |
| `DB_CONNECTION_TIMEOUT_MS` | Optional | `5000` | Time to wait for a connection before failing. |
| `DB_IDLE_TIMEOUT_MS` | Optional | `30000` | How long an idle pooled connection is kept open. |
| `DB_MAX_RETRIES` | Optional | `3` | Query retry attempts on transient DB errors. |
| `DB_RETRY_DELAY_MS` | Optional | `500` | Delay between query retries. |

## Stellar / Soroban

| Variable | Required | Default | Description |
|---|---|---|---|
| `STELLAR_NETWORK` | Optional | `testnet` | `testnet` or `mainnet`. |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Optional | — | Client-visible copy of the network, used by wallet-facing UI. |
| `STELLAR_HORIZON_URL` | Optional | `https://horizon-testnet.stellar.org` | Primary Horizon endpoint. |
| `STELLAR_HORIZON_FALLBACK_URL` | Optional | `""` | Secondary Horizon endpoint used on primary failure. |
| `STELLAR_SOROBAN_RPC_URL` | Optional | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint for contract calls. |
| `STELLAR_NETWORK_PASSPHRASE` | Optional | `Test SDF Network ; September 2015` | Must match the target network exactly (see `MAINNET_RUNBOOK.md` for the mainnet value). |
| `STELLAR_AJO_CONTRACT_ID` | Optional | `""` | Deployed Ajo circle contract ID. Empty until a contract is deployed. |
| `STELLAR_CERTIFICATE_CONTRACT_ID` | Optional | `""` | Deployed certificate/attestation contract ID, if used. |
| `STELLAR_SERVER_SECRET_KEY` | **Required in prod** | `""` | Server-held Stellar secret key used to sign platform transactions. Treat as a critical secret; see `MAINNET_RUNBOOK.md` for signer/HSM guidance. |
| `STELLAR_MAX_FEE_CAP` | Optional | `200` | Max fee (stroops) the app will pay per transaction. |
| `ENABLE_HORIZON_STREAM` | Optional | `false` | Enables the background Horizon streaming service on boot. |
| `ENABLE_EVENT_INDEXER` | Optional | `false` | Enables the background contract event indexer on boot. Note: the event indexer has a known pre-existing bug (see issue #169) independent of this flag. |
| `EVENT_INDEXER_POLL_MS` | Optional | `5000` | Poll interval for the event indexer when enabled. |

## USDC / payments

| Variable | Required | Default | Description |
|---|---|---|---|
| `USDC_ISSUER` | Optional | testnet USDC issuer | Stellar account ID that issues the USDC asset used by the app. |
| `USDC_ASSET_CODE` | Optional | `USDC` | Asset code for USDC. |
| `SLIPPAGE_TOLERANCE_PERCENT` | Optional | `0.5` | Allowed slippage percent for USDC conversions. |
| `PAYSTACK_SECRET_KEY` | **Required in prod** | `""` | Paystack secret API key (NGN on/off-ramp). |
| `PAYSTACK_PLATFORM_SUBACCOUNT` | Optional | `""` | Paystack subaccount ID for platform fee splitting. |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Optional | `""` | Paystack public key used by the client-side checkout widget. |
| `PLATFORM_FEE_PERCENT` | Optional | `0` | Platform fee percentage applied to payouts. |

## SMS / OTP

| Variable | Required | Default | Description |
|---|---|---|---|
| `TERMII_API_KEY` | **Required in prod** | `""` | Termii API key used to send OTP/SMS. |
| `TERMII_SENDER_ID` | Optional | `STELLAR` | Sender ID shown on outgoing SMS. |

## Email

| Variable | Required | Default | Description |
|---|---|---|---|
| `RESEND_API_KEY` | Optional | `""` | Resend API key for transactional email. Email sending is skipped/no-ops if unset. |
| `RESEND_FROM_EMAIL` | Optional | `Ajosave <noreply@ajosave.app>` | From-address used for outgoing email. |

## KYC

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMILE_PARTNER_ID` | Optional | `""` | Smile Identity partner ID for KYC verification. |
| `SMILE_API_KEY` | Optional | `""` | Smile Identity API key. |
| `SMILE_CALLBACK_URL` | Optional | `""` | Callback URL Smile Identity posts KYC results to. |
| `KYC_THRESHOLD_NGN` | Optional | `100000` | NGN contribution amount above which a circle requires KYC. |

## Redis / background jobs

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | Optional | `redis://localhost:6379` | Redis connection string, used for rate limiting/locking/queues. |
| `OUTBOX_BATCH_LIMIT` | Optional | `50` | Rows processed per transactional-outbox dispatch batch (see `docs/transactional-outbox.md`). |
| `OUTBOX_MAX_ATTEMPTS` | Optional | `5` | Max delivery attempts before an outbox row is marked dead. |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | Optional | `10000` | Grace period for background workers to finish in-flight work on shutdown. |

## Cron

| Variable | Required | Default | Description |
|---|---|---|---|
| `CRON_SECRET` | **Required in prod** | `""` | Shared secret that scheduled/cron endpoints check to reject unauthenticated triggers. |

## Security / PII

| Variable | Required | Default | Description |
|---|---|---|---|
| `PII_ENCRYPTION_KEY` | **Required in prod** | `""` | Symmetric key used to encrypt PII at rest (see `src/lib/encryption.ts`). |
| `PII_HMAC_KEY` | **Required in prod** | `""` | HMAC key used for deterministic PII lookups (blind indexing). |
| `ALLOWED_ORIGINS` | Optional | `""` | Comma-separated list of origins allowed by CORS middleware. |

## Observability

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | Optional | `info` | One of `debug`, `info`, `warn`, `error`. |
| `SENTRY_DSN` | Optional | `""` | Server-side Sentry DSN. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | `""` | Client-side Sentry DSN. |

## Wallet

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional | `""` | WalletConnect project ID for wallet-connect UI flows. |

---

`NEXT_RUNTIME` and `NEXT_PHASE` are set by the Next.js runtime itself
(used in `instrumentation.ts` to branch on edge vs. Node.js runtime and to
skip background service startup during `next build`) — they are not meant
to be set manually and are not part of `.env.example`.
