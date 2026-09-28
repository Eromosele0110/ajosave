/**
 * Payment reconciliation (#30).
 *
 * Compares internal ledger records (contributions / payouts) against
 * external settlement records (Stellar transactions, Paystack references)
 * and classifies every discrepancy. Pure and deterministic so it can run
 * from a cron job, an admin endpoint, or tests.
 */
import { logger } from "./logger";

export interface LedgerRecord {
  id: string;
  reference: string | null; // tx_hash or paystack reference
  amountUsdc: string;
  status: string;
}

export interface SettlementRecord {
  reference: string;
  amountUsdc: string;
  successful: boolean;
}

export type DiscrepancyKind =
  | "missing_reference"
  | "missing_settlement"
  | "amount_mismatch"
  | "status_mismatch"
  | "orphan_settlement"
  | "duplicate_reference";

export interface Discrepancy {
  kind: DiscrepancyKind;
  reference: string | null;
  ledgerId?: string;
  expected?: string;
  actual?: string;
}

export interface ReconciliationReport {
  matched: number;
  discrepancies: Discrepancy[];
}

const SETTLED_STATUSES = new Set(["confirmed", "completed"]);

/** Compare decimal strings exactly at 7dp to avoid float drift. */
function toStroops(amount: string): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  return BigInt(whole || "0") * 10_000_000n + BigInt((frac + "0000000").slice(0, 7));
}

export function reconcile(
  ledger: LedgerRecord[],
  settlements: SettlementRecord[],
): ReconciliationReport {
  const discrepancies: Discrepancy[] = [];
  const settlementsByRef = new Map<string, SettlementRecord>();
  for (const s of settlements) {
    if (settlementsByRef.has(s.reference)) {
      discrepancies.push({ kind: "duplicate_reference", reference: s.reference });
      continue;
    }
    settlementsByRef.set(s.reference, s);
  }

  const seen = new Set<string>();
  let matched = 0;

  for (const entry of ledger) {
    const settled = SETTLED_STATUSES.has(entry.status);
    if (!entry.reference) {
      if (settled) discrepancies.push({ kind: "missing_reference", reference: null, ledgerId: entry.id });
      continue;
    }
    if (seen.has(entry.reference)) {
      discrepancies.push({ kind: "duplicate_reference", reference: entry.reference, ledgerId: entry.id });
      continue;
    }
    seen.add(entry.reference);

    const settlement = settlementsByRef.get(entry.reference);
    if (!settlement) {
      if (settled) discrepancies.push({ kind: "missing_settlement", reference: entry.reference, ledgerId: entry.id });
      continue;
    }
    if (toStroops(settlement.amountUsdc) !== toStroops(entry.amountUsdc)) {
      discrepancies.push({
        kind: "amount_mismatch",
        reference: entry.reference,
        ledgerId: entry.id,
        expected: entry.amountUsdc,
        actual: settlement.amountUsdc,
      });
      continue;
    }
    if (settlement.successful !== settled) {
      discrepancies.push({
        kind: "status_mismatch",
        reference: entry.reference,
        ledgerId: entry.id,
        expected: entry.status,
        actual: settlement.successful ? "successful" : "failed",
      });
      continue;
    }
    matched++;
  }

  for (const ref of settlementsByRef.keys()) {
    if (!seen.has(ref)) discrepancies.push({ kind: "orphan_settlement", reference: ref });
  }

  if (discrepancies.length > 0) {
    logger.warn({ matched, discrepancies: discrepancies.length }, "payment reconciliation found discrepancies");
  } else {
    logger.info({ matched }, "payment reconciliation clean");
  }

  return { matched, discrepancies };
}
