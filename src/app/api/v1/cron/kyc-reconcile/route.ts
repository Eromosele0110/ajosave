import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { reconcileKycStatuses, type ReconcileSummary } from "@/lib/kyc-reconciliation";
import type { ApiResponse } from "@/types";

/** GET /api/v1/cron/kyc-reconcile — resolve users stuck in KYC 'pending'. */
export const GET = async (req: NextRequest) => {
  const unauth = await verifyCronSecret(req);
  if (unauth) return unauth;

  const summary = await reconcileKycStatuses();
  return NextResponse.json<ApiResponse<ReconcileSummary>>({ success: true, data: summary });
};
