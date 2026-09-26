import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { serverConfig } from "@/server/config";
import logger from "@/lib/logger";
import {
  verifyPaystackSignature,
  validateWebhookTimestamp,
  extractEventId,
} from "@/lib/webhook-replay";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usdcToStroops(usdc: string | number): bigint {
  const str = typeof usdc === "number" ? usdc.toFixed(7) : usdc;
  const parts = str.split(".");
  const integerPart = parts[0] || "0";
  let fractionPart = parts[1] || "";
  if (fractionPart.length > 7) {
    fractionPart = fractionPart.slice(0, 7);
  } else {
    fractionPart = fractionPart.padEnd(7, "0");
  }
  return BigInt(integerPart + fractionPart);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const rawBody = await req.text();

  // ── 1. Timing-safe HMAC-SHA512 signature verification ───────────────────
  const sigResult = verifyPaystackSignature(
    rawBody,
    signature,
    serverConfig.paystack.secretKey
  );
  if (!sigResult.valid) {
    logger.warn({ reason: sigResult.reason }, "Invalid Paystack webhook signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 2. Parse payload ─────────────────────────────────────────────────────
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn("Paystack webhook: malformed JSON body");
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  // ── 3. Timestamp validation – reject stale events (> 5 minutes old) ─────
  const createdAt = (event.created_at ??
    (event.data as Record<string, unknown> | undefined)?.created_at) as
    | string
    | number
    | undefined;

  const tsResult = validateWebhookTimestamp(createdAt);
  if (!tsResult.valid) {
    logger.warn({ reason: tsResult.reason, createdAt }, "Paystack webhook timestamp rejected");
    return NextResponse.json({ error: "Webhook rejected: stale or invalid timestamp" }, { status: 400 });
  }

  // ── 4. Extract unique event ID ───────────────────────────────────────────
  const eventId = extractEventId(event);
  if (!eventId) {
    logger.error({ event }, "Paystack webhook: could not derive event ID");
    return NextResponse.json({ error: "Missing event ID" }, { status: 400 });
  }

  // ── 5. DB-level deduplication (idempotency check) ────────────────────────
  // Uses a 24-hour window consistent with the original implementation.
  const { rows: existingEvent } = await query(
    `SELECT id FROM processed_webhooks
     WHERE id = $1
       AND provider = 'paystack'
       AND created_at >= NOW() - INTERVAL '24 HOURS'`,
    [eventId]
  );

  if (existingEvent.length > 0) {
    logger.info({ eventId }, "Paystack webhook already processed (duplicate)");
    return NextResponse.json({ received: true, duplicate: true });
  }

  logger.info({ eventId, eventType: event.event }, "Paystack webhook verified and accepted");

  // ── 6. Event-specific handling ───────────────────────────────────────────

  if (event.event === "charge.failed") {
    const data = event.data as Record<string, unknown> | undefined;
    const reference = data?.reference as string | undefined;
    if (!reference) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 });
    }
    await query(
      `UPDATE contributions SET status = 'failed'
       WHERE paystack_reference = $1 AND status = 'pending'`,
      [reference]
    );
    // Record as processed so a replay of the same failure is a no-op
    await query(
      "INSERT INTO processed_webhooks (id, provider, event_type, payload) VALUES ($1, 'paystack', $2, $3) ON CONFLICT DO NOTHING",
      [eventId, event.event, event]
    );
    return NextResponse.json({ received: true });
  }

  if (event.event !== "charge.success") {
    // Record non-charge events to prevent replays
    await query(
      "INSERT INTO processed_webhooks (id, provider, event_type, payload) VALUES ($1, 'paystack', $2, $3) ON CONFLICT DO NOTHING",
      [eventId, event.event, event]
    );
    return NextResponse.json({ received: true });
  }

  // ── 7. charge.success: confirm contribution inside a transaction ─────────
  const data = event.data as Record<string, unknown> | undefined;
  const reference = data?.reference as string | undefined;
  if (!reference) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  try {
    await transaction(async (q) => {
      // Record the webhook as processed within the transaction to ensure
      // atomicity: if the contribution update fails the webhook record rolls back.
      await q(
        "INSERT INTO processed_webhooks (id, provider, event_type, payload) VALUES ($1, 'paystack', $2, $3)",
        [eventId, event.event, event]
      );

      // Fetch the contribution for this reference
      const { rows: contribRows } = await q<{
        id: string;
        amount_usdc: string;
        amount_paid_usdc: string;
        is_partial: boolean;
      }>(
        `SELECT id, amount_usdc, amount_paid_usdc, is_partial
         FROM contributions WHERE paystack_reference = $1 AND status = 'pending' LIMIT 1`,
        [reference]
      );

      if (contribRows.length === 0) {
        logger.info({ reference }, "Paystack reference not found or already confirmed");
        return;
      }

      const contrib = contribRows[0];
      const meta = (data?.metadata ?? {}) as Record<string, unknown>;
      const creditUsdc = meta.payUsdc ?? meta.topUpUsdc ?? contrib.amount_usdc;
      const creditStroops = usdcToStroops(creditUsdc as string | number);
      const contribPaidStroops = usdcToStroops(contrib.amount_paid_usdc);
      const fullStroops = usdcToStroops(contrib.amount_usdc);

      const newPaidStroops = contribPaidStroops + creditStroops;
      const finalPaidStroops = newPaidStroops < fullStroops ? newPaidStroops : fullStroops;
      const isFullyPaid = finalPaidStroops === fullStroops;

      await q(
        `UPDATE contributions
         SET amount_paid_usdc = $1,
             status           = $2,
             tx_hash          = $3,
             updated_at       = NOW()
         WHERE id = $4`,
        [
          (Number(finalPaidStroops) / 10_000_000).toFixed(7),
          isFullyPaid ? "confirmed" : "pending",
          reference,
          contrib.id,
        ]
      );

      logger.info(
        {
          reference,
          isFullyPaid,
          newPaidUsdc: (Number(newPaidStroops) / 10_000_000).toFixed(7),
          fullUsdc: contrib.amount_usdc,
        },
        "Contribution payment credited"
      );
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    // Unique constraint violation: duplicate insert from a race condition
    if ((err as { code?: string }).code === "23505") {
      logger.info({ eventId }, "Duplicate Paystack webhook detected during insert (race)");
      return NextResponse.json({ received: true, duplicate: true });
    }
    logger.error({ err, eventId }, "Error processing Paystack webhook");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
