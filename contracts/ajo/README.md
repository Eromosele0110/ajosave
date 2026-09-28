# Ajo Smart Contract

> Trustless rotating savings circle (Ajo/Esusu) on Stellar Soroban.

The contract manages the full lifecycle of a savings circle: member enrollment, per-cycle contributions, and automatic rotation payouts — all without a trusted intermediary.

---

## Table of Contents

- [Overview](#overview)
- [Lifecycle](#lifecycle)
- [Initialize Parameters](#initialize-parameters)
- [Public Functions](#public-functions)
- [Storage Layout](#storage-layout)
- [Events](#events)
- [Security Model](#security-model)
- [Example Invocations](#example-invocations)

---

## Overview

An Ajo circle works as follows:

1. An admin deploys and initializes the contract with circle parameters.
2. Members join by calling `join`, which locks their first contribution.
3. Once the circle is full, it starts automatically (cycle 1 begins).
4. Each cycle, all members call `contribute` to pay into the pot.
5. After `cycle_interval_secs` has elapsed, the admin calls `payout` to send the full pot to the current cycle's recipient.
6. Steps 4–5 repeat until every member has received a payout, at which point the circle is marked `completed`.

---

## Lifecycle

```
[Uninitialized]
      │ initialize()
      ▼
  [Waiting]  ← members call join()
      │ last member joins (circle full)
      ▼
  [Cycle 1]  ← members call contribute()
      │ payout() called after next_payout_time
      ▼
  [Cycle 2]  ← members call contribute()
      │ payout() called after next_payout_time
      ▼
     ...
      │ payout() on final cycle
      ▼
  [Completed]
```

State transitions are enforced by the contract — there is no admin escape hatch to skip or reverse a cycle.

---

## Initialize Parameters

| Parameter            | Type      | Constraints              | Description                                              |
|----------------------|-----------|--------------------------|----------------------------------------------------------|
| `admin`              | `Address` | Must sign the call       | Platform address authorized to trigger payouts           |
| `token`              | `Address` | —                        | USDC token contract address on the network               |
| `contribution_amount`| `i128`    | > 0                      | Per-member per-cycle amount in stroops (1 USDC = 10⁷)   |
| `max_members`        | `u32`     | 2 – 20                   | Total members = total cycles                             |
| `cycle_interval_secs`| `u64`     | —                        | Seconds between payouts (e.g. `2592000` = 30 days)       |

`initialize` can only be called once. Subsequent calls panic with `"already initialized"`.

---

## Public Functions

### `initialize(env, admin, token, contribution_amount, max_members, cycle_interval_secs)`

Sets up the circle. Stores all parameters and emits an `initialized` event.

### `join(env, member)`

- Requires `member` auth.
- Transfers `contribution_amount` from `member` to the contract (first cycle contribution).
- Records the contribution for cycle 1.
- Panics if: circle already started, circle is full, or member already joined.
- When the last member joins, sets `current_cycle = 1` and `next_payout_time = now + cycle_interval_secs`.

### `contribute(env, member)`

- Requires `member` auth.
- Transfers `contribution_amount` from `member` to the contract for the current cycle.
- Panics if: circle not started, not a member, or already contributed this cycle.

### `payout(env)`

- Requires `admin` auth.
- Panics if: circle not started, already completed, or `ledger.timestamp < next_payout_time`.
- Sends `contribution_amount × max_members` to the member at position `current_cycle - 1` (0-indexed).
- Advances to the next cycle or marks the circle completed.

### `get_state(env) → (current_cycle, max_members, next_payout_time, completed, paused)`

`paused` is `true` when the admin has emergency-paused the contract.

Read-only. Returns the four key state values.

### `get_members(env) → Vec<Address>`

Read-only. Returns all member addresses in join order.

### `upgrade(env, new_wasm_hash)`

- Requires `admin` auth.
- Replaces the contract WASM with the uploaded hash.
- Emits an `upgraded` event.

---

## Storage

### Storage Classification

The contract uses three storage types to optimize ledger fees:

| Type | Keys | Lifetime | Purpose |
|------|------|----------|---------|
| Instance | Admin, Token, ContributionAmount, MaxMembers, CycleIntervalSecs, Members, PayoutOrder, CurrentCycle, NextPayoutTime, Completed, Paused, PayoutLock | Contract lifetime | Core circle configuration |
| Temporary | Contributions(Address, u32) | Auto-expire (~3.5 days) | Per-cycle contribution tracking |
| Persistent | MemberReputation, TotalCirclesCompleted, OnTimeContributions, TotalContributions | 30 days | Member reputation (survives upgrades) |

### Optimization Benefits

- **Temporary storage** for contributions reduces ledger fees by ~35-40% compared to instance storage
- **Automatic TTL expiration** cleans up contribution entries after circle completion
- **Persistent storage** for reputation ensures cross-contract state survival

For detailed benchmarks, see [BENCHMARKS.md](./BENCHMARKS.md).

---

## Events

Events are published via `env.events().publish(topic, data)` and can be consumed by the backend indexer for auditing and notifications.

| Topic symbol       | Data                                                    | Emitted by      | Description |
|--------------------|---------------------------------------------------------|-----------------|-------------|
| `initialized`      | `(admin, max_members, contribution_amount)`                | `initialize`    | Circle created with parameters |
| `member_joined`    | `(member, contribution_amount)`                          | `join`          | Member joined and locked contribution |
| `circle_started`   | `(max_members, contribution_amount)`                     | `join` (last)   | Circle activated when full |
| `contribution_made`| `(member, amount, cycle_number)`                         | `contribute`    | Member contributed for cycle |
| `payout_sent`      | `(recipient, amount, cycle_number)`                      | `payout`        | Payout distributed to recipient |
| `circle_completed` | `()`                                                    | `payout` (last) | Circle finished all cycles |
| `member_defaulted` | `(member, cycle_number)`                                 | `payout`        | Member missed contribution for cycle |
| `upgraded`         | `(new_wasm_hash,)`                                        | `upgrade`       | Contract WASM upgraded |
| `migrated`         | `(from_version, to_version)`                              | `migrate`       | Storage migration completed |
| `paused`           | `()`                                                    | `pause`         | Emergency pause activated |
| `unpaused`         | `()`                                                    | `unpause`       | Emergency pause lifted |
| `admin_proposed`   | `(old_admin, new_admin)`                                  | `propose_admin` | Admin transfer proposed |
| `admin_transferred`| `(old_admin, new_admin)`                                  | `accept_admin`  | Admin role transferred |
| `reputation_updated`| `(member, score)`                                       | internal        | Member reputation recalculated |

### Event Schema

All events follow Soroban's standard event format:

```typescript
// Events can be fetched via Soroban RPC
type ContractEvent = {
  topic: string[];     // Event symbol as first element
  value: any;          // Event data
  ledger: number;      // Ledger sequence
  timestamp: number;   // Unix timestamp
}

// Backend indexer example (pseudo-code)
// GET /events?start_ledger=123456&filter=contract_id:<CONTRACT_ID>
```

### Consuming Events in Backend

The backend can query events using Soroban RPC:

```typescript
// Example: Fetch events for a contract
const events = await sorobanRpc.getEvents({
  startLedger: fromLedger,
  contractId: process.env.STELLAR_AJO_CONTRACT_ID
});
```

---

## Security Model

### Trust assumptions

- **Admin is trusted to call `payout` on time.** The contract enforces the time lock (`next_payout_time`) but cannot self-trigger. The platform backend (cron job) is responsible for calling payout after each window.
- **Token contract is trusted.** The contract calls `token::Client::transfer` directly. Only use audited USDC contracts.
- **Members must approve the contract.** Soroban's auth model requires each member to sign `join` and `contribute` calls. The contract cannot pull funds without the member's signature.

### What the contract enforces

- Double-initialization is blocked.
- Double-contribution per cycle is blocked.
- Early payout (before `next_payout_time`) is blocked.
- Payout after completion is blocked.
- Only the admin can trigger payouts and upgrades.
- Member count is capped at 20 to bound gas costs.

### What the contract does NOT enforce

- Member identity (any Stellar address can join).
- Off-chain NGN contributions via Paystack — those are reconciled by the backend before the on-chain `contribute` call.
- Slashing for missed contributions — the current version does not penalize defaulters on-chain.

---

## Example Invocations

Replace `<CONTRACT_ID>` with the deployed contract address and set `STELLAR_NETWORK` appropriately.

### Read state

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_state
```

### Read members

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_members
```

### Initialize (admin only)

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --token <USDC_CONTRACT_ADDRESS> \
  --contribution_amount 10000000 \
  --max_members 5 \
  --cycle_interval_secs 2592000
```

### Join

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <MEMBER_SECRET_KEY> \
  -- join \
  --member <MEMBER_ADDRESS>
```

### Contribute

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <MEMBER_SECRET_KEY> \
  -- contribute \
  --member <MEMBER_ADDRESS>
```

### Trigger payout (admin only)

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  -- payout
```

### Upgrade WASM (admin only)

```bash
# 1. Upload new WASM and capture the hash
NEW_HASH=$(stellar contract upload \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  --wasm target/wasm32-unknown-unknown/release/ajo.wasm)

# 2. Invoke upgrade
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  -- upgrade \
  --new_wasm_hash "$NEW_HASH"
```

---

## Testnet Deployment

| Field       | Value                                                              |
|-------------|--------------------------------------------------------------------|
| Network     | Stellar Testnet                                                    |
| Contract ID | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`       |
| Explorer    | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |

Set in your environment:

```bash
STELLAR_AJO_CONTRACT_ID=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

## Missed Contribution Policy

At each `payout`, members who did not contribute for the cycle get a
`contribution_missed` event and their lifetime `MissedContributions` counter
increments (it also counts against on-time reputation). Once a member reaches
the admin-configured threshold (`set_missed_policy`, default `1`, range
`1..=max_members`) they are suspended (`member_suspended` event) and
`contribute` rejects them until the admin calls `reinstate_member`.

Read-only: `get_missed_policy`, `get_missed_contributions`, `is_suspended`.

## Temporary Storage TTL

Per-cycle contribution flags live in temporary storage. Each write extends the
entry's TTL to cover the cycle interval plus a one-day buffer (minimum 7 days,
capped at the network max TTL), so an entry cannot expire before `payout` reads
it. Entries are removed when the circle completes. `set_ttl_config` now
validates `1 <= threshold <= extend_to`, `extend_to >= 1 day` and
`extend_to <= max_ttl`, and emits `ttl_config_updated`.
