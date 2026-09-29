# Privacy & Data Retention Guide

> **Audience:** engineers, compliance reviewers, and data protection officers.  
> **Last updated:** 2026-09-29

---

## Overview

Ajosave handles two categories of sensitive personal data:

| Category | Examples | Regulation concern |
|---|---|---|
| **Financial data** | contributions, payouts, Paystack references, USDC amounts | FINTRAC / NDPA / local AML rules; must be retained for regulatory audit |
| **Identity / PII** | phone numbers, email addresses, KYC documents | NDPA (Nigeria), GDPR (EU diaspora); must be protected at rest and purged when no longer needed |

This guide covers retention schedules, deletion jobs, encryption at rest, and
right-to-erasure handling.

---

## Retention Schedules

### What is retained indefinitely (or until manual review)

| Table / data | Reason |
|---|---|
| `contributions` | Financial record — regulatory audit trail |
| `payouts` | Financial record — regulatory audit trail |
| `audit_logs` | Tamper-evident security log |
| `circles` | Core business record |

These tables are **explicitly excluded** from the automated deletion jobs
(`src/lib/retention.ts`) and must only be removed via an approved data-removal
request with legal sign-off.

### Automated deletion schedules

Implemented in `src/lib/retention.ts` and invoked by the cron API route
(`src/app/api/cron/cycle/`). One failing table does not stop the others.

| Table | Column | Retention window | Notes |
|---|---|---|---|
| `sessions` | `expires_at` | 7 days | Expired auth sessions |
| `processed_webhooks` | `created_at` | 30 days | Replay-protection log |
| `sms_logs` | `created_at` | 90 days | Contains phone numbers |
| `outbox_events` | `processed_at` | 30 days | Only processed rows |

Deletions run in batches of up to 1 000 rows, capped at 50 batches per run
(`DEFAULT_BATCH_SIZE = 1000`, `MAX_BATCHES_PER_RUN = 50`), to prevent long
table locks. A `truncated: true` result means a backlog remains and the next
run will continue.

**Minimum retention floor:** `MIN_RETENTION_DAYS = 7`. A policy with `days < 7`
will throw at startup to prevent accidental early deletion.

### KYC document retention

KYC documents (identity images, verification results) are held for the
duration required by the applicable AML regulations (typically 5 years after
the end of the business relationship). They are stored outside PostgreSQL
(object storage) and are not covered by the automated job above. Deletion
requires a manual, audited process.

---

## PII Encryption at Rest

Phone numbers and email addresses are encrypted using AES-256-GCM before
being written to the database. The implementation is in `src/lib/encryption.ts`.

- **Key source:** `ENCRYPTION_KEY` environment variable (32-byte hex).
  See `docs/environment-variables.md` for rotation guidance.
- **Migration:** `migrations/1749000000000_pii-encryption-phone-email.ts`
  added the encrypted columns. The backfill script
  (`scripts/backfill-pii-encryption.ts`) encrypted all existing rows.
- **Access:** decryption happens server-side only; encrypted bytes are never
  returned to the client.

### Encryption key rotation

1. Generate a new key: `openssl rand -hex 32`
2. Add `ENCRYPTION_KEY_PREVIOUS=<old key>` to environment alongside the new
   `ENCRYPTION_KEY`.
3. Run the backfill script (it re-encrypts all rows with the new key if
   `ENCRYPTION_KEY_PREVIOUS` is set).
4. Remove `ENCRYPTION_KEY_PREVIOUS` from the environment after backfill
   completes.

---

## Right to Erasure (Right to be Forgotten)

A user may request deletion of their personal data. The following procedure
applies:

### What can be erased

- `users.phone` and `users.email` → overwrite encrypted value with a
  tombstone marker (e.g. `[deleted]` encrypted) so referential integrity is
  preserved.
- `sms_logs` rows referencing the user → batch-delete.
- `sessions` rows for the user → delete immediately.
- KYC documents → archive request sent to KYC provider for deletion.

### What cannot be erased

- `contributions`, `payouts`, `audit_logs` — financial/regulatory records.
  The user's Stellar address may appear in these records; an address is
  pseudonymous (not directly PII under most frameworks) and is retained.

### Procedure

1. Receive written erasure request from the user (email or in-app).
2. Verify identity (re-authenticate via OTP).
3. Run the erasure job (not yet automated — tracked in backlog):
   ```sql
   -- Tombstone phone and email
   UPDATE users SET phone = '[deleted]', email = '[deleted]' WHERE id = $1;
   -- Delete sessions
   DELETE FROM sessions WHERE user_id = $1;
   -- sms_logs are auto-purged within 90 days; manual delete if urgent
   DELETE FROM sms_logs WHERE user_id = $1;
   ```
4. Log the erasure in `audit_logs` with action `user_data_erased`.
5. Notify the user within 30 days of the request (GDPR / NDPA requirement).

---

## Data Minimisation

- Phone numbers and email addresses are collected only where required for
  OTP authentication and contribution notifications.
- KYC data is collected only when required by AML thresholds.
- The Paystack webhook payload is stored only as a hash reference
  (`processed_webhooks`) — not the full payload — to support replay
  protection without retaining raw payment details longer than necessary.

---

## Third-Party Data Sharing

| Recipient | Data shared | Purpose | Retention at recipient |
|---|---|---|---|
| Paystack | Phone, amount, reference | Payment processing | Per Paystack privacy policy |
| Termii | Phone number, OTP message | OTP delivery | Per Termii privacy policy |
| KYC provider | Identity documents | AML / KYC verification | Per provider policy (typically 5 years) |
| Sentry | Anonymised stack traces | Error monitoring | 90 days (configured in Sentry project) |
| Stellar network | Stellar address, USDC amount | On-chain payout | Immutable (public ledger) |

> **Note:** Stellar address and transaction amounts written to the Stellar
> ledger are **immutable and public**. Users must be informed of this before
> their wallet is linked to the platform.

---

## Observability & Auditing

- Every retention job run is logged via `logger.info` / `logger.error` with
  the table name, rows deleted, and `truncated` flag.
- Sentry captures unhandled errors in the retention job.
- The CI workflow does **not** run the retention job automatically; it runs on
  the production cron schedule only. Add a unit test if the policy list
  changes (see `src/lib/retention.ts` for the test surface).

---

## CI Checks

The automated deletion logic is covered by unit tests in
`src/__tests__/` and enforced in CI via the `test` job in
`.github/workflows/ci.yml`. Any change to `POLICIES` in `src/lib/retention.ts`
must include a corresponding test update.

---

## References

- `src/lib/retention.ts` — retention job implementation
- `src/lib/encryption.ts` — PII encryption helpers
- `scripts/backfill-pii-encryption.ts` — backfill script
- `migrations/1749000000000_pii-encryption-phone-email.ts` — PII encryption migration
- `docs/environment-variables.md` — encryption key configuration
- `docs/secrets-security.md` — secret inventory and rotation
- `SECURITY.md` — vulnerability disclosure policy
