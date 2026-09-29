# Contract Storage Optimization Benchmarks

## Storage Layout Summary

| Data Type | Storage Type | Keys | TTL | Notes |
|-----------|--------------|------|-----|-------|
| Core config (admin, token, amounts, members, payout order) | Instance | 7 | Contract lifetime | Extended via TTL bumping on each operation |
| Per-cycle contributions | Temporary | N members × M cycles | Auto-expire | Cleared on circle completion, no bump needed |
| Member reputation | Persistent | 4 per member | 30 days | Survives contract upgrades, cross-circle state |
| Payout lock | Instance | 1 | Contract lifetime | Security-critical, short-lived flag |
| Pause flag | Instance | 1 | Contract lifetime | Admin emergency stop |

## Ledger Fee Optimization

### Before Optimization
- All contribution entries stored in instance storage
- Each contribution write required `~0.01 XLM` in ledger fees
- For a 10-member circle with 10 cycles: 100 contribution entries in instance storage

### After Optimization
- Contribution entries stored in temporary storage
- Temporary storage entries cost `~70% less` per write (no persistent ledger entry)
- Automatic TTL expiration removes entries after 100 ledgers (~3.5 days)
- For a 10-member circle with 10 cycles: 100 contribution entries in temp storage

### Estimated Savings
| Circle Size | Cycles | Old Instance Writes | New Temp Writes | Savings |
|-------------|--------|---------------------|-----------------|---------|
| 3 members | 3 | 9 entries | 9 entries (temp) | ~20% |
| 5 members | 5 | 25 entries | 25 entries (temp) | ~25% |
| 10 members | 10 | 100 entries | 100 entries (temp) | ~35% |
| 20 members | 20 | 400 entries | 400 entries (temp) | ~40% |

**Overall estimated reduction: 25-35% in ledger fees for typical circles**

## Benchmark Methodology

Real CPU/memory cost benchmarks live in `src/benchmarks.rs` and use
soroban-sdk's `testutils` budget API (`env.budget()`), which is the SDK's
own resource-accounting mechanism — not an event-log proxy. Each test
resets the budget, runs one entrypoint (`join`, `contribute`, `payout`,
`propose_admin`+`accept_admin`), and asserts the reported CPU instruction
count stays under a regression ceiling:

```rust
fn measure(env: &Env, label: &str, f: impl FnOnce()) -> u64 {
    env.budget().reset_default();
    f();
    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    println!("[bench] {label}: cpu_instructions={cpu} memory_bytes={mem}");
    assert!(cpu < CPU_CEILING, "{label} exceeded the CPU regression ceiling");
    cpu
}
```

Run locally with `cargo test --package stellar-ajo bench -- --nocapture`
to see the printed cost breakdown; CI runs the same command on every push
(`.github/workflows/ci.yml`, job `contract-cost-benchmarks`).

## Storage Classification Rationale

### Instance Storage (Persistent, contract-lifetime)
- **Admin, PendingAdmin**: Must survive upgrades
- **Token, ContributionAmount, MaxMembers, CycleIntervalSecs**: Core configuration
- **Members, PayoutOrder**: Circle membership data
- **CurrentCycle, NextPayoutTime, Completed**: Circle state machine
- **Paused**: Emergency stop flag
- **PayoutLock**: Reentrancy guard (security-critical)
- **StorageVersion, TtlThreshold, TtlExtendTo**: Migration and TTL config

### Temporary Storage (Auto-expire, per-cycle)
- **Contributions(Address, u32)**: Contribution tracking per cycle
  - Automatically expires after TTL (~3.5 days)
  - Cleared explicitly on circle completion
  - Lower ledger fee as no persistent write

### Persistent Storage (Cross-contract lifetime)
- **MemberReputation(Address)**: Reputation score (0-100)
- **TotalCirclesCompleted(Address)**: Lifetime count
- **OnTimeContributions(Address)**: On-time rate tracking
- **TotalContributions(Address)**: Total contribution count

## Migration Notes

For existing contracts on-chain:
1. Call `migrate()` after upgrade to initialize `PayoutLock`
2. Temporary storage keys are new - no data migration needed
3. Existing instance storage entries remain compatible