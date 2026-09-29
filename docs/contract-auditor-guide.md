# Contract Auditor Guide

> **Audience:** external security auditors and internal reviewers assessing the Ajo Soroban contract.  
> **Contract location:** `contracts/ajo/src/`  
> **Last updated:** 2026-09-29

---

## Overview

The Ajo contract manages the full lifecycle of a rotating savings circle on
Stellar Soroban: member enrollment, per-cycle contributions, and automatic
rotation payouts — all without a trusted intermediary. This guide explains the
trust model, attack surface, edge cases, and how to reproduce audit-relevant
scenarios locally.

---

## Trust Model

| Actor | Capabilities | Constraints |
|---|---|---|
| **Admin** | `initialize`, `payout`, `upgrade`, `pause`, `unpause`, `propose_admin`, `set_payout_order`, `set_missed_policy`, `reinstate_member` | Multi-sig (≥ 2-of-3 on mainnet). Cannot skip or reverse a cycle. Cannot pull member funds directly. |
| **Member** | `join`, `contribute` | Must sign their own calls. Cannot call payout or upgrade. Cannot join twice. |
| **Anyone** | `get_state`, `get_members` | Read-only. |

---

## Code Entry Points

```
contracts/ajo/src/
├── lib.rs          # Public interface — all externally callable functions
├── storage.rs      # Storage key definitions and type aliases
├── events.rs       # All contract events
└── test.rs         # Unit tests (cfg(test) only)
```

Start with `lib.rs`. Each public function is marked `#[contractimpl]`.

---

## Function-by-Function Security Notes

### `initialize`

- **Double-init guard:** checks `Initialized` flag in instance storage; panics
  with `"already initialized"` on a second call. ✅
- **Parameter validation:**
  - `admin ≠ token ≠ contract address`
  - `cycle_interval_secs` in `1..=31_536_000` (prevents overflow in timestamp
    arithmetic)
  - `contribution_amount * max_members` overflow check
  - `max_members` in `2..=20` (bounds on-chain gas cost)
- **Edge case:** `initialize` does not require member auth — only admin auth.
  An admin could initialize with a zero-member circle if `max_members < 2` is
  not validated. The `2..=20` check closes this.

### `set_payout_order`

- Admin-only, callable only before the circle starts (`current_cycle == 0`).
- `order` must be a permutation of `0..max_members`: correct length, every
  index in range, no duplicates. Auditors should verify the dedup check is
  O(n) not O(n²) and cannot be bypassed with a crafted slice.

### `join`

- **Auth:** requires `member.require_auth()` — the contract cannot pull funds
  without the member's signature.
- **Re-entrancy:** Soroban's token `transfer` is synchronous and atomic within
  the ledger; there is no cross-contract callback that could re-enter `join`.
- **Edge cases:**
  - Member joins twice → `"already a member"` panic. ✅
  - Circle already started → `"circle already started"` panic. ✅
  - Circle full → `"circle is full"` panic. ✅
  - Token transfer fails (insufficient balance) → Soroban rolls back the entire
    invocation; no partial state is written. ✅

### `contribute`

- **Auth:** requires `member.require_auth()`.
- **Double-contribution guard:** uses temporary storage keyed on
  `(member, cycle)`. Each `contribute` write extends the entry TTL to cover
  the cycle window + 1-day buffer (min 7 days, capped at network max).
- **Edge cases:**
  - Contribute before circle starts → `"circle not started"` panic.
  - Contribute after circle completes → `"circle is completed"` panic.
  - Contribute twice in same cycle → temporary storage key already set →
    panic. ✅
  - Suspended member calls `contribute` → `"member suspended"` panic.

### `payout`

- **Auth:** requires admin auth (multisig threshold on mainnet).
- **Time lock:** `ledger.timestamp >= next_payout_time` enforced; early payout
  panics with `"payout not yet due"`. ✅
- **Payout amount:** `contribution_amount × max_members` — auditors should
  verify this matches the actual token balance after all members have
  contributed. A member default (missed contribution) means the balance is
  `(max_members - defaulters) × contribution_amount`. The current contract
  **does not hold back partial pots** — the recipient receives whatever is
  in the contract. This is intentional but auditors should flag it as a
  known behaviour.
- **Re-entrancy:** same as `join` — token transfer is atomic, no callback.
- **Completion guard:** after the final cycle the `Completed` flag is set;
  subsequent `payout` calls panic. ✅
- **Payout lock (`PayoutLock`):** set to `true` for the duration of the payout
  and cleared afterward. Prevents a re-entrant admin call from double-paying.
  This flag is only settable in `#[cfg(test)]` via `set_payout_lock` — verify
  it is absent from production paths.

### `upgrade`

- **Auth:** requires admin multisig approval (M-of-N via `approve_operation`).
- **WASM hash validation:** Soroban verifies the hash refers to an uploaded
  WASM blob before executing the upgrade.
- **Risk:** an upgrade can change any contract logic. Auditors should verify
  that `upgrade` emits the `upgraded` event with the new hash for on-chain
  traceability. ✅

### `pause` / `unpause`

- Admin-only. Sets `Paused` flag in instance storage.
- While paused, `join`, `contribute`, and `payout` all panic with
  `"contract is paused"`.
- **Risk:** an admin can pause indefinitely. The multisig threshold mitigates
  single-admin abuse but auditors should note there is no automatic unpause
  or timelock.

---

## Storage Layout & Lifetime

| Type | Keys | Lifetime |
|---|---|---|
| Instance | Admin, Token, ContributionAmount, MaxMembers, CycleIntervalSecs, Members, PayoutOrder, CurrentCycle, NextPayoutTime, Completed, Paused, PayoutLock, MultisigConfig | Contract lifetime |
| Temporary | `Contributions(Address, u32)` | Auto-expires ~3.5 days; TTL extended per cycle |
| Persistent | MemberReputation, TotalCirclesCompleted, OnTimeContributions, TotalContributions, MissedContributions | 30 days (survives upgrades) |

**Auditor note:** temporary storage TTL extension logic is in `contribute`.
Verify the TTL buffer is sufficient for the longest allowed cycle interval
(365 days). As of this writing, the ledger max TTL is `6 312 000` ledgers
(~1 year); for cycles approaching 365 days the code must use the network max,
not an arbitrary cap.

---

## Edge Cases & Boundary Conditions

| Scenario | Expected behaviour | Where to verify |
|---|---|---|
| `contribution_amount = 1` (minimum) | valid | `initialize` validation |
| `max_members = 2` (minimum) | valid; 2-cycle circle | `initialize` validation |
| `max_members = 20` (maximum) | valid | `initialize` validation |
| `max_members = 21` | panic | `initialize` validation |
| `cycle_interval_secs = 1` | valid (instant rotation for tests) | `initialize` validation |
| `cycle_interval_secs = 31_536_001` | panic | `initialize` validation |
| `contribution_amount × max_members` overflows `i128` | panic | `initialize` overflow check |
| Member balance exactly equals `contribution_amount` | transfer succeeds | `join` |
| Member balance one stroop short | token transfer fails, full rollback | `join` |
| Admin calls `payout` one second before `next_payout_time` | panic | `payout` time check |
| Admin calls `payout` exactly at `next_payout_time` | succeeds | `payout` time check |
| All members default (contribute nothing) | payout sends 0 USDC; recipient gets nothing | `payout` |
| Circle at cycle N, admin upgrades WASM | state is preserved; new WASM takes over | `upgrade` + `get_state` |
| `set_payout_order` called after circle starts | panic | `set_payout_order` guard |
| Member calls `reinstate_member` | panic — admin-only | `reinstate_member` auth |

---

## Known Limitations (by design)

1. **No slashing on-chain.** Defaulting members are recorded via
   `member_defaulted` event and the missed-contribution counter, but no funds
   are seized. Off-chain reputation scoring handles social enforcement.

2. **Admin can pause indefinitely.** No timelock. Mitigated by multisig and
   off-chain governance.

3. **Token trust.** The contract calls `token::Client::transfer` without
   verifying the token is the USDC contract. Only the admin (via
   `initialize`) can set the token; auditors should verify the deployed token
   address matches the canonical USDC contract on the target network.

4. **NGN contributions are off-chain.** Paystack (NGN) contributions are
   reconciled by the backend before calling `contribute` on-chain. This
   reconciliation is not verifiable from the contract alone.

---

## Reproducing Audit Scenarios Locally

### 1. Build the contract

```bash
cargo build \
  --manifest-path contracts/ajo/Cargo.toml \
  --target wasm32-unknown-unknown \
  --release
```

### 2. Run all unit tests

```bash
cargo test --manifest-path contracts/ajo/Cargo.toml -- --nocapture
```

### 3. Run fuzz targets

```bash
# Requires cargo-fuzz (nightly)
cd contracts/ajo
cargo +nightly fuzz run contribute_fuzz -- -max_total_time=60
cargo +nightly fuzz run payout_fuzz    -- -max_total_time=60
```

See `contracts/ajo/fuzz/` and `docs/contract-fuzzing.md` for full details.

### 4. Run cost benchmarks

```bash
cd contracts
cargo test --package stellar-ajo bench -- --nocapture
```

### 5. Deploy to testnet and exercise the full lifecycle

```bash
STELLAR_NETWORK=testnet npm run contract:deploy
stellar contract invoke --id <CONTRACT_ID> --network testnet -- get_state
```

---

## CI Checks That Cover the Contract

| Workflow | What it checks |
|---|---|
| `.github/workflows/ci.yml` — `contract` job | Builds WASM + runs `cargo test` on every PR |
| `.github/workflows/ci.yml` — `contract-cost-benchmarks` job | Runs benchmark tests to catch gas regressions |
| `.github/workflows/security.yml` — `cargo-audit` job | Scans Rust dependencies for known CVEs |
| `.github/workflows/contract-fuzz.yml` | Runs fuzz targets on a schedule |
| `.github/workflows/contract-wasm-release.yml` | Reproducible-build verification on release tags |

---

## Checklist for Auditors

- [ ] Verify `initialize` double-init guard
- [ ] Verify `join` / `contribute` auth requirements (`require_auth`)
- [ ] Verify payout time lock logic
- [ ] Verify `contribution_amount × max_members` overflow guard
- [ ] Verify payout lock flag is absent from non-test production paths
- [ ] Verify temporary storage TTL extension for long cycles
- [ ] Verify `set_payout_order` permutation validation (dedup correctness)
- [ ] Verify `upgrade` emits event with new WASM hash
- [ ] Verify `pause` / `unpause` cover all state-mutating functions
- [ ] Confirm deployed token address matches canonical USDC on target network
- [ ] Review missed-contribution counter for integer overflow
- [ ] Review multisig threshold configuration (`get_multisig_config`)
- [ ] Confirm `#[cfg(test)]`-only helpers are not reachable in production WASM

---

## References

- `contracts/ajo/README.md` — public function reference and lifecycle diagram
- `contracts/ajo/EVENTS.md` — full event schema
- `contracts/ajo/BENCHMARKS.md` — cost benchmarks
- `contracts/ajo/FUND_LOCKING_CHECKLIST.md` — fund-safety checklist
- `contracts/ajo/UPGRADE.md` — upgrade and migration guide
- `docs/contract-fuzzing.md` — fuzz testing setup
- `docs/multisig-admin.md` — multisig admin configuration
- `MAINNET_RUNBOOK.md` — mainnet deployment runbook
