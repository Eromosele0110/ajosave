/**
 * Explicit state machines for the payment-related statuses used across
 * Ajosave (contributions and payouts).
 *
 * Today these statuses are set ad hoc via raw SQL UPDATE statements
 * scattered across webhook handlers, admin routes, and services (see
 * src/app/api/v1/webhooks/paystack/route.ts, src/app/api/admin/payouts/[id]/retry/route.ts,
 * src/server/services/scheduler.service.ts). Nothing validates that a given
 * transition is actually legal before writing it, so a bug or a duplicate
 * webhook delivery can silently move a row into a nonsensical state (e.g.
 * "refunded" -> "pending").
 *
 * This module gives call sites a single place to check "is this transition
 * allowed" before issuing the UPDATE. It intentionally does not change any
 * existing call site — wiring it in is a larger, more invasive change that
 * touches the payment-critical webhook/admin code paths one at a time.
 *
 * ── Known discrepancy (found while writing this) ────────────────────────
 * The Postgres CHECK constraint on contributions.status (see
 * migrations/1746000000000_add-refunded-contribution-status.ts and
 * docs/schema.sql) only allows
 *   'pending' | 'confirmed' | 'missed' | 'refund_pending' | 'refunded'
 * but src/app/api/v1/webhooks/paystack/route.ts writes status = 'failed'
 * on a charge.failed event, and the TypeScript ContributionStatus type in
 * src/types/index.ts only lists 'pending' | 'confirmed' | 'missed'. 'failed'
 * is therefore a status that exists in practice but is missing from both
 * the DB constraint and the type. This module treats 'failed' as a real
 * reachable state (matching what the code actually does) rather than the
 * incomplete constraint/type — reconciling the DB constraint and the type
 * is a separate, schema-level fix left out of scope here.
 */

// ─── Contributions ──────────────────────────────────────────────────────────

export const CONTRIBUTION_STATUSES = [
  "pending",
  "confirmed",
  "missed",
  "failed",
  "refund_pending",
  "refunded",
] as const;

export type ContributionState = (typeof CONTRIBUTION_STATUSES)[number];

const CONTRIBUTION_TRANSITIONS: Record<ContributionState, readonly ContributionState[]> = {
  // A freshly created contribution is awaiting Paystack confirmation.
  pending: ["confirmed", "failed", "missed"],
  // Payment confirmed on-chain/off-chain; can still be refunded later
  // (e.g. circle cancelled, member disputes a charge).
  confirmed: ["refund_pending"],
  // Terminal: the charge failed outright (charge.failed webhook).
  failed: [],
  // Terminal: the cycle deadline passed with no contribution recorded.
  missed: [],
  // A refund has been initiated but the on-chain/off-chain confirmation
  // has not landed yet.
  refund_pending: ["refunded"],
  // Terminal: refund confirmed.
  refunded: [],
};

// ─── Payouts ────────────────────────────────────────────────────────────────

export const PAYOUT_STATUSES = ["pending", "completed", "failed"] as const;

export type PayoutState = (typeof PAYOUT_STATUSES)[number];

const PAYOUT_TRANSITIONS: Record<PayoutState, readonly PayoutState[]> = {
  // Default status on creation (see migrations/1748600000000_add-payout-status.ts,
  // which defaults existing/new rows to 'completed' for backfill purposes —
  // new payout attempts driven through the retry flow start at 'pending').
  pending: ["completed", "failed"],
  // Terminal: on-chain payout confirmed.
  completed: [],
  // An admin can reset a failed payout back to 'pending' to retry it
  // (see src/app/api/admin/payouts/[id]/retry/route.ts).
  failed: ["pending"],
};

// ─── Shared machinery ───────────────────────────────────────────────────────

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly entity: "contribution" | "payout",
    public readonly from: string,
    public readonly to: string
  ) {
    super(`Invalid ${entity} status transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

function transitionAllowed<T extends string>(
  transitions: Record<T, readonly T[]>,
  from: T,
  to: T
): boolean {
  if (from === to) return false; // no-op transitions are not "transitions"
  return transitions[from]?.includes(to) ?? false;
}

export function canTransitionContribution(from: ContributionState, to: ContributionState): boolean {
  return transitionAllowed(CONTRIBUTION_TRANSITIONS, from, to);
}

export function assertContributionTransition(from: ContributionState, to: ContributionState): void {
  if (!canTransitionContribution(from, to)) {
    throw new InvalidStateTransitionError("contribution", from, to);
  }
}

export function isTerminalContributionState(state: ContributionState): boolean {
  return CONTRIBUTION_TRANSITIONS[state].length === 0;
}

export function canTransitionPayout(from: PayoutState, to: PayoutState): boolean {
  return transitionAllowed(PAYOUT_TRANSITIONS, from, to);
}

export function assertPayoutTransition(from: PayoutState, to: PayoutState): void {
  if (!canTransitionPayout(from, to)) {
    throw new InvalidStateTransitionError("payout", from, to);
  }
}

export function isTerminalPayoutState(state: PayoutState): boolean {
  return PAYOUT_TRANSITIONS[state].length === 0;
}
