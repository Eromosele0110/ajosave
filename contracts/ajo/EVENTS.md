# Ajo Contract — Event Schema Reference

This is the compatibility contract between `contracts/ajo/src/lib.rs` and its
off-chain consumers (`src/server/services/event-indexer.service.ts`,
`src/lib/soroban.ts`). Every event below is published via
`env.events().publish((Symbol::new(&env, "<topic>"),), <data>)`, so `<data>`
is a **positional tuple**, not a named-field object.

Selected event shapes are locked with regression tests in
`contracts/ajo/src/lib.rs` (`test_initialized_event_schema`,
`test_member_joined_event_schema`, `test_contribution_made_event_schema`) and
`contracts/ajo/src/integration_tests.rs` (`test_defaulted_event`,
`test_upgrade_emits_event`). Changing a tuple's field order or type is a
breaking change for any off-chain consumer and should bump the emitting
function's doc comment here alongside the code change.

| Topic | Data tuple (in order) | Emitted by |
|---|---|---|
| `initialized` | `(admin: Address, max_members: u32, contribution_amount: i128)` | `initialize` |
| `member_joined` | `(member: Address, amount: i128)` | `join` |
| `circle_started` | `(max_members: u32, amount: i128)` | `join` (last member) |
| `contribution_made` | `(member: Address, amount: i128, cycle: u32)` | `contribute` |
| `member_defaulted` | `(member: Address, cycle: u32)` | `payout` |
| `payout_sent` | `(recipient: Address, pot: i128, cycle: u32)` | `payout` |
| `circle_completed` | `()` (no data) | `payout` (final cycle) |
| `reputation_updated` | `(member: Address, reputation: u32)` | internal `update_reputation` |
| `migrated` | `(from_version: u32, to_version: u32)` | `migrate` |
| `upgraded` | `(new_wasm_hash: BytesN<32>)` | `upgrade` |
| `paused` | `()` (no data) | `pause` |
| `unpaused` | `()` (no data) | `unpause` |
| `admin_proposed` | `(admin: Address, new_admin: Address)` | `propose_admin` |
| `admin_transferred` | `(old_admin: Address, new_admin: Address)` | `accept_admin` |

## Known compatibility gap (found while adding this reference)

`src/server/services/event-indexer.service.ts` decodes `event.value` as if it
were a named-field object — e.g. `onPayoutSent` reads
`val.circle_id`, `val.recipient_address`, `val.amount`, `val.cycle` — but per
the table above `payout_sent` is actually the positional tuple
`(recipient, pot, cycle)` with **no `circle_id` field at all** (each deployed
contract instance is a single circle, so there is no on-chain `circle_id` to
read). `circle_completed` publishes `()` with no data at all, yet
`onCircleCompleted` unconditionally does `if (!val.circle_id) return;` —
meaning that handler currently short-circuits on every `circle_completed`
event.

Additionally, `getContractEvents` in `src/lib/soroban.ts` passes through the
raw RPC `getEvents` response (`value: e.value`) without decoding the
Soroban XDR/`ScVal` payload into native values at all, so `event.value` is
not yet a plain JS value on either code path.

This doc records the actual on-chain shapes so that fixing the indexer (wiring
an XDR→native decode step and reading tuples positionally, plus deriving
`circle_id` from the contract address rather than the event payload) can be
scoped as its own change with a clear target schema, rather than guessed at
again. That decode-layer fix is out of scope for this change — it touches the
production indexer's DB side-effects and needs its own test pass — so it is
called out here rather than attempted opportunistically.
