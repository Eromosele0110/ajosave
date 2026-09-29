# Changelog

All notable changes to Ajosave are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- CSRF: cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` requests to `/api/*` must now come from an allowed origin (`Origin`, `Referer` or `Sec-Fetch-Site`), else `403`; bearer-token, cookie-less, webhook and NextAuth built-in requests are unaffected (#104)
- SSRF: outbound requests to Soroban RPC, the KYC provider and the faucet go through `safeFetch`, which blocks private/loopback/link-local/metadata destinations, non-HTTPS schemes, embedded credentials and redirects (#105)
- OTP: per-phone resend cooldown (60 s), per-phone daily cap (10) and per-IP hourly cap (20) on send, `429` with `Retry-After`; OTPs now use `crypto.randomInt` and constant-time comparison (#109)
- Exports: both CSV exports now stream through the hardened helper (no-store headers, formula-injection guard, row cap) and deleted accounts export nothing; account deletion also revokes sessions and purges phone-keyed Redis state (#110)

## [0.1.0] - 2026-04-24

### Added

- Soroban smart contract (`contracts/ajo/`) implementing the full Ajo circle lifecycle: `initialize`, `join`, `contribute`, `payout`, `upgrade`
- On-chain events for all state transitions: `initialized`, `started`, `joined`, `contributed`, `payout`, `completed`, `defaulted`, `upgraded`
- OTP phone authentication via Termii SMS and NextAuth session management
- JWT session expiry and secure cookie handling
- Circle creation, browse, and join flows (Next.js 14 App Router)
- Dashboard for tracking a user's active circles and contribution history
- Paystack NGN on-ramp for fiat contributions
- PostgreSQL persistence for circle records and payout state
- Redis-backed rate limiting and caching
- Soroban payout integration — server-side signing and submission to Stellar network
- Docker and docker-compose configuration for local development
- Vercel deployment configuration (`vercel.json`)
- CI pipeline (GitHub Actions): lint, type-check, Prettier format check, unit tests with Codecov, Next.js build, Soroban contract tests, and automatic testnet contract deployment on merge to `main`
- Automated PostgreSQL backup workflow
- Branch protection and PR validation checks via GitHub Actions
- HTTPS/HSTS and Content Security Policy (CSP) response headers
- SQL injection prevention via parameterised queries
- Sentry APM integration for client, server, and edge runtimes
- Health check endpoint (`/api/health`)
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`

### Infrastructure

- Stellar Testnet contract deployment: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

[Unreleased]: https://github.com/JosephOnuh/ajosave/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JosephOnuh/ajosave/releases/tag/v0.1.0
