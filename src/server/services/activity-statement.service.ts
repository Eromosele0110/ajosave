import { query } from "@/lib/db";
import logger from "@/lib/logger";

export interface ActivityEntry {
  type: "contribution" | "payout_received" | "circle_joined" | "circle_completed";
  circleId: string;
  circleName: string;
  amountUsdc?: string;
  cycleNumber?: number;
  txHash?: string;
  occurredAt: Date;
  description: string;
}

export interface ActivityStatement {
  userId: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  totalContributedUsdc: string;
  totalReceivedUsdc: string;
  circleCount: number;
  entries: ActivityEntry[];
}

export async function generateActivityStatement(
  userId: string,
  opts: { from?: Date; to?: Date } = {}
): Promise<ActivityStatement> {
  const periodEnd = opts.to ?? new Date();
  const periodStart = opts.from ?? new Date(periodEnd.getTime() - 365 * 24 * 60 * 60 * 1000);

  // Get confirmed contributions
  const contribResult = await query<{
    id: string;
    circle_id: string;
    circle_name: string;
    cycle_number: number;
    amount_usdc: string;
    tx_hash: string | null;
    created_at: Date;
  }>(
    `SELECT c.id, c.circle_id, ci.name AS circle_name, c.cycle_number,
            c.amount_usdc, c.tx_hash, c.created_at
     FROM contributions c
     JOIN members m ON m.id = c.member_id
     JOIN circles ci ON ci.id = c.circle_id
     WHERE m.user_id = $1
       AND c.status = 'confirmed'
       AND c.created_at BETWEEN $2 AND $3
     ORDER BY c.created_at DESC`,
    [userId, periodStart, periodEnd]
  );

  // Get payouts received
  const payoutResult = await query<{
    id: string;
    circle_id: string;
    circle_name: string;
    cycle_number: number;
    amount_usdc: string;
    tx_hash: string;
    paid_at: Date;
  }>(
    `SELECT p.id, p.circle_id, ci.name AS circle_name, p.cycle_number,
            p.amount_usdc, p.tx_hash, p.paid_at
     FROM payouts p
     JOIN members m ON m.id = p.recipient_member_id
     JOIN circles ci ON ci.id = p.circle_id
     WHERE m.user_id = $1
       AND p.paid_at BETWEEN $2 AND $3
     ORDER BY p.paid_at DESC`,
    [userId, periodStart, periodEnd]
  );

  // Build and sort entries chronologically (newest first)
  const entries: ActivityEntry[] = [
    ...contribResult.rows.map((r) => ({
      type: "contribution" as const,
      circleId: r.circle_id,
      circleName: r.circle_name,
      amountUsdc: r.amount_usdc,
      cycleNumber: r.cycle_number,
      txHash: r.tx_hash ?? undefined,
      occurredAt: r.created_at,
      description: `Contributed ${r.amount_usdc} USDC to ${r.circle_name} (cycle ${r.cycle_number})`,
    })),
    ...payoutResult.rows.map((r) => ({
      type: "payout_received" as const,
      circleId: r.circle_id,
      circleName: r.circle_name,
      amountUsdc: r.amount_usdc,
      cycleNumber: r.cycle_number,
      txHash: r.tx_hash,
      occurredAt: r.paid_at,
      description: `Received payout of ${r.amount_usdc} USDC from ${r.circle_name} (cycle ${r.cycle_number})`,
    })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const totalContributedUsdc = contribResult.rows
    .reduce((sum, r) => sum + parseFloat(r.amount_usdc), 0)
    .toFixed(7);

  const totalReceivedUsdc = payoutResult.rows
    .reduce((sum, r) => sum + parseFloat(r.amount_usdc), 0)
    .toFixed(7);

  const circleIds = new Set(entries.map((e) => e.circleId));

  logger.info(
    { userId, periodStart, periodEnd, entryCount: entries.length },
    "activity statement generated"
  );

  return {
    userId,
    generatedAt: new Date(),
    periodStart,
    periodEnd,
    totalContributedUsdc,
    totalReceivedUsdc,
    circleCount: circleIds.size,
    entries,
  };
}
