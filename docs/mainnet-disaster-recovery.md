# Mainnet Disaster Recovery

> **Audience:** on-call engineers and platform owners responding to a
> production-level failure on Stellar mainnet.  
> **Prerequisite reading:** `MAINNET_RUNBOOK.md` (deployment / upgrade),
> `docs/incident-runbook.md` (application incidents), `docs/backup.md`
> (database restore).  
> **Last updated:** 2026-09-29

---

## Disaster Categories

| Category | Severity | Description |
|---|---|---|
| **DR-1** | Critical | Contract funds at risk (bug, exploit, admin key compromise) |
| **DR-2** | Critical | Database lost or corrupted — circles unrecoverable from app state |
| **DR-3** | High | Payout scheduler down — cycles not paid on time |
| **DR-4** | High | Admin key loss — cannot trigger payouts or upgrades |
| **DR-5** | Medium | Stellar network partition — RPC endpoints unreachable |

---

## DR-1: Contract Funds at Risk

This is the highest-severity scenario. Act within minutes.

### Immediate response

1. **Page all admins.** Do not act alone.
2. **Pause the contract immediately** (requires M-of-N admin signatures):

   ```bash
   # Collect M-of-N approvals for the pause operation
   OP_HASH=$(echo -n "pause" | sha256sum | awk '{print $1}')

   stellar contract invoke \
     --network mainnet \
     --rpc-url "$STELLAR_RPC_URL" \
     --source <SIGNER_N_SECRET_KEY> \
     --id "$STELLAR_AJO_CONTRACT_ID" \
     -- approve_operation \
     --signer <SIGNER_N_ADDRESS> \
     --op_hash "$OP_HASH"

   # Once threshold reached, execute pause
   stellar contract invoke \
     --network mainnet \
     --rpc-url "$STELLAR_RPC_URL" \
     --source <SIGNER_1_SECRET_KEY> \
     --id "$STELLAR_AJO_CONTRACT_ID" \
     -- pause \
     --caller <SIGNER_1_ADDRESS> \
     --op_hash "$OP_HASH"
   ```

3. **Confirm the contract is paused:**

   ```bash
   stellar contract invoke \
     --network mainnet \
     --rpc-url "$STELLAR_RPC_URL" \
     --id "$STELLAR_AJO_CONTRACT_ID" \
     -- get_state
   # paused field must be true
   ```

4. **Disable the cron payout scheduler** in the hosting platform to prevent
   further on-chain calls while the contract is paused.

5. **Assess the exploit:** review recent contract events for unexpected
   `payout_sent` or `member_joined` entries:

   ```bash
   stellar events \
     --network mainnet \
     --contract-id "$STELLAR_AJO_CONTRACT_ID" \
     --start-ledger <LAST_KNOWN_GOOD_LEDGER>
   ```

6. **If an admin key is compromised:** immediately proceed to DR-4 (admin key
   recovery) before unpausing.

7. **Deploy a fix:** follow the upgrade runbook in `MAINNET_RUNBOOK.md`
   (Steps U1–U5) with the patched WASM. Collect M-of-N approvals. Do not
   unpause until the fix is live and verified on testnet.

8. **Unpause and notify users** once the fix is confirmed:

   ```bash
   stellar contract invoke \
     --network mainnet \
     --rpc-url "$STELLAR_RPC_URL" \
     --source <SIGNER_1_SECRET_KEY> \
     --id "$STELLAR_AJO_CONTRACT_ID" \
     -- unpause \
     --caller <SIGNER_1_ADDRESS> \
     --op_hash <UNPAUSE_OP_HASH>
   ```

9. **Post-incident:** write a postmortem within 48 hours. Update
   `MAINNET_RUNBOOK.md` post-deployment record table.

---

## DR-2: Database Lost or Corrupted

The on-chain contract is the source of truth for fund custody. The database
holds circle metadata, user accounts, and contribution records that are
needed for the application to function.

### Recovery steps

1. **Identify the last verified backup:**

   ```bash
   aws s3 ls s3://${S3_BACKUP_BUCKET}/backups/postgres/ --recursive | sort | tail -10
   ```

2. **Restore from backup** (see `docs/backup.md` for full procedure):

   ```bash
   export DATABASE_URL=<production connection string>
   export S3_BACKUP_BUCKET=<bucket name>
   export AWS_DEFAULT_REGION=<backup region>
   ./scripts/pg_restore.sh backups/postgres/<TIMESTAMP>.sql.gz
   ```

   > The restore script drops and recreates the database. It has a 5-second
   > abort window. Ensure there is **no live traffic** before restoring.

3. **Verify the restore:**

   ```bash
   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM circles;"
   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM contributions;"
   psql "$DATABASE_URL" -c "SELECT MAX(created_at) FROM audit_logs;"
   ```

4. **Reconcile against on-chain state** for any contributions or payouts that
   happened after the backup timestamp:

   - Query the Stellar network for `payout_sent` and `contribution_made`
     events since the backup timestamp ledger.
   - Re-insert missing contribution and payout rows into the database.
   - Use `scripts/audit-sql.ts` to verify referential integrity.

5. **Run database migrations** to ensure the schema is current:

   ```bash
   npm run db:migrate
   ```

6. **Re-enable the application** and confirm the health endpoint:

   ```bash
   curl -s "$NEXT_PUBLIC_APP_URL/api/v1/health" | jq .
   ```

### Data loss window

Backups run at **02:00 UTC daily**. Maximum data loss (RPO) is ~24 hours.
If a more recent backup is available (e.g. a manual backup taken before a
risky migration), use that instead.

---

## DR-3: Payout Scheduler Down

Members are waiting for payouts and the cron job is not running.

### Diagnosis

```bash
# Check the last cron run
gh run list --workflow=ci.yml --limit 5
# Check application logs for cron endpoint errors
# Check /api/cron/cycle returns 200 when called manually
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "$NEXT_PUBLIC_APP_URL/api/cron/cycle" | jq .
```

### Manual payout trigger

If the cron infrastructure is down but the application is up, trigger
payouts manually for each overdue circle:

1. Identify overdue circles (circles where `next_payout_time < now` and
   `completed = false`):

   ```bash
   stellar contract invoke \
     --network mainnet \
     --rpc-url "$STELLAR_RPC_URL" \
     --id "$STELLAR_AJO_CONTRACT_ID" \
     -- get_state
   ```

2. Trigger payout directly on-chain (requires M-of-N admin signatures
   as for any payout operation):

   ```bash
   stellar contract invoke \
     --network mainnet \
     --rpc-url "$STELLAR_RPC_URL" \
     --source <SIGNER_1_SECRET_KEY> \
     --id "$STELLAR_AJO_CONTRACT_ID" \
     -- payout \
     --caller <SIGNER_1_ADDRESS> \
     --op_hash <PAYOUT_OP_HASH>
   ```

3. **Multiple circles:** repeat for each active circle. The backend tracks
   the circle-to-contract-ID mapping in the `circles` table.

4. Restore the cron scheduler and monitor for the next scheduled run.

### SLA commitment

The platform targets payout delivery within **2 hours** of `next_payout_time`.
Delays beyond 24 hours should be treated as a SEV1 and escalated.

---

## DR-4: Admin Key Loss

If one signer key is lost but the multisig threshold (M-of-N) is still
reachable with remaining signers, recover as follows:

### If M-of-N quorum is still available

1. Generate a new signer keypair:

   ```bash
   stellar keys generate new-signer --network mainnet
   # Fund the new account with XLM
   ```

2. Use the existing quorum to propose and execute an admin transfer:

   ```bash
   # Propose new admin (existing quorum signs)
   stellar contract invoke \
     --network mainnet \
     --source <SIGNER_1_SECRET_KEY> \
     --id "$STELLAR_AJO_CONTRACT_ID" \
     -- propose_admin \
     --caller <SIGNER_1_ADDRESS> \
     --new_admin <NEW_SIGNER_ADDRESS> \
     --op_hash <PROPOSE_OP_HASH>

   # New signer accepts
   stellar contract invoke \
     --network mainnet \
     --source <NEW_SIGNER_SECRET_KEY> \
     --id "$STELLAR_AJO_CONTRACT_ID" \
     -- accept_admin \
     --caller <NEW_SIGNER_ADDRESS>
   ```

3. Update the signer list in all CI secrets and environment configurations.

4. Revoke/destroy the lost keypair if not already compromised.

### If M-of-N quorum is NOT available (catastrophic key loss)

- The contract is effectively frozen — `payout`, `upgrade`, and `pause` are
  all blocked.
- Member funds are safe (the contract cannot be drained without admin auth).
- **No automated recovery path exists.** This requires a Stellar protocol-level
  intervention or a new contract deployment with fund migration (requires
  community coordination and likely a governance vote).
- **Prevention:** store signer keypairs on hardware wallets in separate
  physical locations. Document key locations in a sealed physical record
  accessible to at least two independent parties.

---

## DR-5: Stellar Network Partition / RPC Unavailable

The Stellar network itself is unavailable or the configured RPC endpoint is
down.

### Mitigation

1. **Switch to a backup RPC endpoint.** Configure at least two RPC providers:

   ```bash
   # Primary
   STELLAR_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<API_KEY>
   # Fallback
   STELLAR_RPC_URL_FALLBACK=https://horizon.stellar.org
   ```

   Update `src/lib/soroban.ts` to fall back automatically or update the
   environment variable and redeploy.

2. **Check Stellar network status:** [https://status.stellar.org](https://status.stellar.org)

3. **Inform users:** post a status update. No funds are at risk during a
   network partition — all state is preserved on-chain.

4. **Defer payouts:** if `next_payout_time` passes during the outage, the
   contract will still accept the payout call once the network is restored
   (the time lock is based on ledger timestamp, not wall clock). Trigger
   manually once connectivity is restored (see DR-3).

---

## Recovery Communication Template

Use this when notifying users during a DR event:

```
Subject: [Ajosave] Service disruption — update

We are currently experiencing [brief description]. Your funds held in
the Ajosave smart contract on the Stellar network are safe and have
not been affected.

We are working to resolve the issue. Expected resolution: [time].

Affected: [list of impacted features]
Not affected: [on-chain funds, payout eligibility]

We will send another update at [time] or sooner if resolved.

— Ajosave Team
```

---

## Post-Recovery Checklist

- [ ] Both uptime workflow jobs green: `gh run list --workflow=uptime.yml --limit 2`
- [ ] `/api/v1/health` returns `db: ok`, `redis: ok`
- [ ] Spot-check 3–5 circles: verify `get_state` cycle and `next_payout_time`
- [ ] Verify no unprocessed outbox rows: `SELECT COUNT(*) FROM outbox_events WHERE processed_at IS NULL AND created_at < NOW() - INTERVAL '1 hour'`
- [ ] Confirm cron scheduler is running and last run succeeded
- [ ] Write postmortem (template in `docs/incident-runbook.md`)
- [ ] Update `MAINNET_RUNBOOK.md` post-deployment record if a contract change was involved
- [ ] Notify users that service is restored

---

## References

- `MAINNET_RUNBOOK.md` — contract deployment and upgrade steps
- `docs/incident-runbook.md` — application-level incident response
- `docs/backup.md` — database backup and restore
- `docs/multisig-admin.md` — multisig admin setup
- `docs/SECRET_ROTATION.md` — key rotation procedures
- `SECURITY.md` — security vulnerability disclosure
- `contracts/ajo/README.md` — contract CLI reference
