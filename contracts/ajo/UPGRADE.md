# Contract Upgrade Guide

The Ajo contract exposes an admin-only, two-step **upgrade governance**
flow that replaces the running WASM in-place using Soroban's
`update_current_contract_wasm`. All storage (members, cycles, balances) is
preserved across upgrades.

1. `propose_upgrade(new_wasm_hash)` — admin proposes a new WASM hash and
   starts a 48-hour timelock (`UPGRADE_TIMELOCK_SECS`), emitting an
   `upgrade_proposed` event with the hash and the earliest execution time.
   This is the governance boundary for #55: it gives circle members a
   window to notice a pending upgrade (via the emitted event / an indexer)
   and exit before new logic goes live, instead of an admin being able to
   swap the contract instantly and unilaterally.
2. `cancel_upgrade()` — admin may cancel a pending proposal at any time
   before it executes, emitting `upgrade_cancelled`.
3. `upgrade(new_wasm_hash)` — executes a previously proposed upgrade.
   Reverts if there is no pending proposal, if `new_wasm_hash` doesn't
   match the proposed hash, or if the timelock hasn't elapsed yet.

## Prerequisites

- Stellar CLI installed (`stellar --version`)
- Admin keypair available
- New contract code compiled to WASM

## Steps

### 1. Build the new WASM

```bash
npm run contract:build
# Output: contracts/ajo/target/wasm32-unknown-unknown/release/ajo.wasm
```

### 2. Upload the WASM blob (does not deploy a new contract)

```bash
stellar contract upload \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  --wasm contracts/ajo/target/wasm32-unknown-unknown/release/ajo.wasm
# Prints: <NEW_WASM_HASH>
```

### 3. Propose the upgrade

```bash
stellar contract invoke \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  --id <CONTRACT_ID> \
  -- propose_upgrade \
  --new_wasm_hash <NEW_WASM_HASH>
```

This starts the 48-hour governance timelock and emits `upgrade_proposed`.
Wait for the timelock to elapse (or `cancel_upgrade` to abort).

### 4. Execute the upgrade

```bash
stellar contract invoke \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  --id <CONTRACT_ID> \
  -- upgrade \
  --new_wasm_hash <NEW_WASM_HASH>
```

The contract emits an `upgraded` event containing the new WASM hash. Verify it in Stellar Explorer or via:

```bash
stellar events --contract-id <CONTRACT_ID> --topic upgraded
```

### 5. Verify

```bash
stellar contract invoke \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  --id <CONTRACT_ID> \
  -- get_state
```

Confirm the circle state is intact and the new logic is active.

## Verifying a WASM artifact

Every GitHub release runs `.github/workflows/contract-wasm-release.yml`,
which rebuilds `ajo.wasm` and `certificate.wasm` from source and publishes
them on the release alongside a `SHA256SUMS.txt`. Before trusting a
`<NEW_WASM_HASH>` used in step 3 above, rebuild locally and compare:

```bash
npm run contract:build
sha256sum contracts/target/wasm32-unknown-unknown/release/*.wasm
# Compare against the release's SHA256SUMS.txt and against the hash
# printed by `stellar contract upload` in step 2.
```

## Notes

- Only the `admin` address set during `initialize` can call `upgrade`.
- No data migration is needed unless the new version changes storage key layouts — in that case add a `migrate()` function before calling `upgrade`.
- For mainnet upgrades, test on testnet first and have the admin multisig approve the transaction.
