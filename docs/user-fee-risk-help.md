# User Fee & Risk Help

> **Audience:** users and support staff. Explains all fees a user may
> encounter, what financial risks exist, and what protections are in place.  
> **Last updated:** 2026-09-29

---

## What Fees Will I Pay?

### 1. Stellar network transaction fee

Every on-chain action (joining a circle, contributing, receiving a payout)
requires a small Stellar transaction fee paid in XLM.

| Action | Typical fee |
|---|---|
| Join a circle | ~0.00001 XLM (1 stroop base) |
| Contribute for a cycle | ~0.00001 XLM |
| Receive a payout | ~0.00001 XLM (fee paid by the contract, not the recipient) |

Stellar fees are determined by the network at the time of the transaction
and may increase during congestion. They are denominated in XLM, not USDC.
The platform covers the fee for the payout transaction; you cover the fee
for your own `join` and `contribute` calls.

### 2. Paystack payment fee (NGN on-ramp)

If you fund your contribution via Paystack (Naira), Paystack charges a
processing fee on each card or bank transfer transaction.

| Method | Paystack fee (as of 2024) |
|---|---|
| Card payment | 1.5% + ₦100 (capped at ₦2 000) |
| Bank transfer | ₦50 flat |

These fees are charged by Paystack and are visible in the Paystack checkout
screen before you confirm. Ajosave does not mark them up.

### 3. Currency conversion (NGN → USDC)

When you contribute in NGN, the platform converts your payment to USDC at
the live exchange rate fetched from the FX provider (`src/lib/fx.ts`).

- The exchange rate shown to you is refreshed every few minutes.
- There is a small spread built into the rate. The exact spread is shown on
  the contribution screen before you confirm.
- Rates can change between when you see the quote and when the payment
  settles. The rate locked at the time of your Paystack payment confirmation
  is the rate applied.

### 4. Platform service fee

Ajosave currently charges **no platform service fee** during the beta period.
Any future fee will be announced at least 30 days in advance and will be
shown clearly before any transaction.

---

## What Risks Should I Know About?

### Contribution risk

Once you join a circle and lock your first contribution, **you cannot
withdraw early without a penalty** (see early-exit policy below). Make sure
you can commit to all cycles before joining.

### Payout order risk

Payout order is assigned at random (or by the admin for private circles)
before the circle starts. You may receive your payout in the first cycle or
the last. If you are last, your money is locked for the full duration of the
circle. This is the fundamental nature of a rotating savings group.

### Default risk

If other members fail to contribute in a given cycle, the payout for that
cycle will be smaller (or zero if all members default). The contract sends
whatever USDC is in its balance. There is no insurance fund at this time.

**What the platform does to mitigate this:**
- Missed contributions are recorded on-chain (`member_defaulted` event).
- Members who miss a contribution above the configured threshold are
  suspended and cannot contribute until reinstated by the admin.
- Reputation scores decrease for defaults, making habitual defaulters
  visible to circle admins.
- Circle admins can set a minimum reputation score for joining a circle.

### Exchange-rate risk

Contributions are held as USDC (a USD-pegged stablecoin). If you are in
Nigeria, the NGN/USD exchange rate may move between when you contribute and
when you receive your payout. Your USDC payout amount is fixed, but its
value in NGN may be higher or lower.

### Smart contract risk

The Ajo contract has been reviewed and fuzz-tested (see
`docs/contract-auditor-guide.md`). However, smart contracts can contain
bugs. A critical bug could, in a worst case, lock or lose funds. The
platform has:

- An emergency pause function (admin can halt all activity).
- An upgrade mechanism to deploy a fix.
- A multisig requirement (2-of-3) for mainnet admin actions.

### Platform / admin risk

The platform admin can pause the contract but **cannot** directly withdraw
member funds. The payout function sends funds only to the designated
recipient for that cycle; there is no admin withdrawal function. The
multisig threshold further limits single-admin abuse.

### Regulatory risk

Cryptocurrency and stablecoin regulations vary by country. Using USDC may
be restricted or taxed in your jurisdiction. Consult local regulations
before participating.

---

## Early Exit Policy

If you need to exit a circle before it completes:

1. Contact the circle admin or support.
2. Your remaining locked contributions may be subject to a penalty to
   compensate the other members.
3. Early exit is handled off-chain; there is no automated on-chain early-exit
   function in the current version.

---

## What Happens If the Platform Goes Down?

Your USDC is held in the Soroban smart contract on the Stellar network — not
in Ajosave's bank account. The Stellar network operates independently of the
platform's servers.

- **During a platform outage:** existing on-chain circles continue to accrue
  time. Once the platform is restored, pending payouts will be triggered.
- **If the platform shuts down permanently:** you can interact with the
  contract directly using the Stellar CLI or any Soroban-compatible wallet,
  using the public contract ID. See `contracts/ajo/README.md` for CLI
  invocation examples.

---

## Getting Help

| Issue | Where to go |
|---|---|
| Payment not reflecting | Check the transaction status in your Paystack receipt, then contact support |
| Payout not received | Check the circle's current cycle on-chain (`get_state`), then contact support |
| Fee dispute | Contact support with your Paystack reference or Stellar transaction ID |
| Security concern | See `SECURITY.md` — do not post publicly |

Support email: **support@ajosave.app**

---

## References

- `contracts/ajo/README.md` — contract function reference
- `docs/contract-auditor-guide.md` — security audit details
- `docs/ngn-to-usdc-flow.md` — NGN → USDC conversion flow
- `src/lib/fx.ts` — exchange rate implementation
- `SECURITY.md` — security vulnerability disclosure
