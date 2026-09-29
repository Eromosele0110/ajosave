# Ajo Contract — Fund-Locking Review Checklist

The Ajo contract is a custodian: `join`/`contribute` move member funds into
the contract's own token balance, and `payout` moves the pooled pot back out
to one recipient per cycle. This checklist is for reviewing any change to
`contracts/ajo/src/lib.rs` for ways that custody could get stuck — funds that
end up neither with a member nor correctly paid out.

Each item below is either covered by an existing/added automated test
(referenced by name) or flagged as an open question for a human reviewer.

## Checklist

- [x] **Reentrancy guard covers the whole payout window.** `PayoutLock` is set
  before any external call and cleared only after the token transfer
  succeeds; a re-entrant `payout()` call while locked panics.
  Covered by `test_payout_reentrancy_guard` (`integration_tests.rs`).
- [x] **The lock is actually released on the happy path**, so a stuck lock
  doesn't permanently freeze future payouts.
  Covered by `test_payout_lock_released_after_success` (`integration_tests.rs`).
- [x] **Effects happen before the external transfer** (checks-effects-
  interactions): cycle/completion state is written before
  `token_client.transfer` is called, so a failed transfer doesn't leave the
  contract's internal state inconsistent with what was actually paid out.
  See the "Effects before external call" section in `payout()`.
- [x] **`pause()` actually stops both sides of fund movement.** A frozen
  circle must not let `contribute` deposit more funds, nor `payout` release
  the pool, while paused.
  Covered by `test_paused_blocks_contribute` and `test_paused_blocks_payout`
  (added — no pause/payout-interaction test existed before this change).
- [x] **`unpause()` restores fund movement** — pausing must be reversible and
  not a way to accidentally strand funds forever.
  Covered by `test_unpause_restores_payout` (added).
- [x] **A fully-funded cycle payout leaves no dust behind** in the contract's
  own balance.
  Covered by `test_payout_drains_contract_balance_when_fully_funded` (added).
- [x] **The token/issuer is validated before any state (and therefore any
  future fund custody) is set up.** See `contracts/ajo/EVENTS.md`'s sibling
  concern in issue #58 — `initialize()` now probes the token contract before
  persisting it.
- [ ] **Open question — payout pot vs. actual collected balance.**
  `payout()` computes `pot = contribution_amount * max_members`
  unconditionally, while the loop directly above it publishes
  `member_defaulted` for any member who didn't pay that cycle. If one or
  more members default, the contract's actual collected balance for that
  cycle is `contribution_amount * (contributing members)`, which is less
  than `pot`. No test in this repo currently exercises a `payout()` call
  where a default has occurred in that same cycle (`test_defaulted_event`
  in `lib.rs` triggers the default detection but does not assert on the
  resulting token balances or on whether the transfer itself succeeds).
  **A human reviewer with the ability to run `cargo test` should confirm
  whether `payout()` succeeds, panics, or (worst case) partially applies
  state when a default has occurred, and whether that could strand the
  non-defaulting members' contributed funds in the contract with no
  payout path forward.** This is called out here rather than fixed
  speculatively, since a fix (e.g. computing the pot from actual temporary-
  storage contributions rather than `max_members`, or explicitly reverting
  the whole cycle when a default is detected) changes payout semantics for
  every member and needs its own reviewed test pass, not a guess made
  without being able to execute the test suite.
- [ ] **Open question — `migrate()`/`upgrade()` and balance accounting.**
  Both mutate storage/WASM but never touch the token balance directly, which
  is the correct instinct (custody should be orthogonal to code upgrades).
  Worth a reviewer double-check whenever a future migration block is added
  under "Add future migration blocks here" in `migrate()`, since that is the
  one place future changes are explicitly invited.
