import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { joinCircleSchema } from "@/types/schemas";
import { joinCircle, getCircleById } from "@/server/services/circle.service";
import { withErrorHandler, withRateLimit } from "@/server/middleware";
import { verifyInviteToken } from "@/lib/tokens";
import { checkReputationGate } from "@/server/services/reputation.service";
import { isKycVerified } from "@/lib/kyc";
import { serverConfig } from "@/server/config";
import { withAdvisoryLock } from "@/lib/concurrency";
import type { ApiResponse, Member } from "@/types";

export const POST = withRateLimit(withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = ctx as { params: { id: string } };
  const userId = (session.user as { id: string }).id;
  const body = await req.json();
  const parsed = joinCircleSchema.safeParse({ ...body, circleId: params.id });
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  const { token } = parsed.data;
  const circle = await getCircleById(params.id);
  if (!circle) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Circle not found" },
      { status: 404 }
    );
  }

  let isInvited = false;
  if (circle.circleType === "private") {
    if (!token) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Invite token is required for private circles" },
        { status: 403 }
      );
    }
    const decoded = await verifyInviteToken(token);
    if (!decoded || decoded.circleId !== params.id) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Invalid or expired invite token" },
        { status: 403 }
      );
    }
    isInvited = true;
  } else if (token) {
    const decoded = await verifyInviteToken(token);
    if (decoded && decoded.circleId === params.id) isInvited = true;
  }

  // ── Reputation gate ───────────────────────────────────────────────────────
  if (circle.minReputation && circle.minReputation > 0) {
    const { eligible, currentScore } = await checkReputationGate(userId, circle.minReputation);
    if (!eligible) {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: `This circle requires a minimum reputation score of ${circle.minReputation}. Your current score is ${currentScore}.`,
        },
        { status: 403 }
      );
    }
  }

  // ── KYC gate ──────────────────────────────────────────────────────────────
  // A circle triggers KYC if its own kyc_threshold is set, OR if the
  // contribution amount meets the global KYC_THRESHOLD_NGN.
  const circleThreshold = (circle as { kycThreshold?: number | null }).kycThreshold;
  const globalThreshold = serverConfig.kyc.thresholdNgn;
  const contributionNgn = typeof circle.contributionFiat === "number"
    ? circle.contributionFiat
    : parseFloat(circle.contributionFiat as unknown as string) || 0;
  const effectiveThreshold = circleThreshold ?? globalThreshold;

  if (contributionNgn >= effectiveThreshold) {
    const verified = await isKycVerified(userId);
    if (!verified) {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: "Identity verification (KYC) is required to join circles above ₦" +
            effectiveThreshold.toLocaleString() +
            ". Please complete verification at /api/v1/kyc/verify.",
          code: "KYC_REQUIRED",
        },
        { status: 403 }
      );
    }
  }

  const member = await withAdvisoryLock("circle:join", params.id, () =>
    joinCircle(params.id, userId, isInvited)
  );
  return NextResponse.json<ApiResponse<Member>>({ success: true, data: member }, { status: 201 });
}));
