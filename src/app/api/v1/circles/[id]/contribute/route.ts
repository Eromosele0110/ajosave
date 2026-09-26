import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCircleById, getMembersByCircle } from "@/server/services/circle.service";
import { initializePayment } from "@/lib/paystack";
import { serverConfig } from "@/server/config";
import { withErrorHandler, withIdempotency, withRateLimit } from "@/server/middleware";
import { query } from "@/lib/db";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { ApiResponse } from "@/types";

const bodySchema = z.object({
  partialAmountFiat: z.number().positive().optional(),
});

export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = ctx as { params: { id: string } };
  const circle = await getCircleById(params.id);
  if (!circle) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Circle not found" },
      { status: 404 }
    );
  }
  if (circle.status !== "active") {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Circle is not active" },
      { status: 400 }
    );
  }

  const circleMembers = await getMembersByCircle(params.id);
  const userId = (session.user as { id: string; email?: string }).id;
  const member = circleMembers.find((m) => m.userId === userId);
  if (!member) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "You are not a member of this circle" },
      { status: 403 }
    );
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  // Check for existing contribution this cycle
  const { rows: existing } = await query<{
    id: string;
    paystack_reference: string;
    authorization_url: string;
    amount_paid_usdc: string;
    status: string;
  }>(
    `SELECT id, paystack_reference, authorization_url, amount_paid_usdc, status
     FROM contributions WHERE member_id = $1 AND cycle_number = $2 LIMIT 1`,
    [member.id, circle.currentCycle]
  );

  if (existing[0]?.status === "confirmed") {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Contribution already confirmed for this cycle" },
      { status: 400 }
    );
  }

  // Return existing pending URL if present
  if (existing[0]?.status === "pending" && existing[0].authorization_url) {
    return NextResponse.json<ApiResponse<{ authorizationUrl: string; reference: string }>>({
      success: true,
      data: { authorizationUrl: existing[0].authorization_url, reference: existing[0].paystack_reference },
    });
  }

  const fullFiat = circle.contributionFiat;
  const fullUsdc = parseFloat(circle.contributionUsdc);
  const payFiat = parsed.data.partialAmountFiat
    ? Math.min(parsed.data.partialAmountFiat, fullFiat)
    : fullFiat;
  const isPartial = payFiat < fullFiat;
  const payUsdc = ((payFiat / fullFiat) * fullUsdc).toFixed(7);

  const reference = `ajo-${params.id}-${member.id}-${circle.currentCycle}-${Date.now()}`;
  const callbackUrl = `${serverConfig.app.url}/circles/${params.id}/contribute/callback?reference=${reference}`;

  const { authorizationUrl } = await initializePayment({
    email: (session.user as { email?: string }).email ?? `${userId}@ajosave.app`,
    amount: payFiat,
    currency: circle.contributionCurrency,
    reference,
    callbackUrl,
    metadata: { circleId: params.id, memberId: member.id, cycleNumber: circle.currentCycle, isPartial, payUsdc },
  });

  await query(
    `INSERT INTO contributions
       (id, circle_id, member_id, cycle_number, amount_usdc, amount_paid_usdc, is_partial, status, paystack_reference, authorization_url)
     VALUES ($1,$2,$3,$4,$5,0,$6,'pending',$7,$8)
     ON CONFLICT (member_id, cycle_number) DO UPDATE
       SET paystack_reference = EXCLUDED.paystack_reference,
           authorization_url  = EXCLUDED.authorization_url,
           is_partial         = EXCLUDED.is_partial`,
    [randomUUID(), params.id, member.id, circle.currentCycle, circle.contributionUsdc, isPartial, reference, authorizationUrl]
  );

  return NextResponse.json<ApiResponse<{ authorizationUrl: string; reference: string; isPartial: boolean; remainingUsdc: string }>>({
    success: true,
    data: { authorizationUrl, reference, isPartial, remainingUsdc: circle.contributionUsdc },
  });
});
