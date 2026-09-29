/**
 * POST /api/stellar/faucet
 *
 * Testnet-only endpoint. Funds the given Stellar public key with:
 *   1. 10,000 XLM via Friendbot (creates the account if needed)
 *   2. 100 USDC from the server wallet
 *
 * Blocked entirely on mainnet.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendUsdcPayment } from "@/lib/stellar";
import { serverConfig } from "@/server/config";
import { outboundPolicy, safeFetch } from "@/lib/ssrf";
import { withRateLimit, withErrorHandler } from "@/server/middleware";
import type { ApiResponse } from "@/types";

const USDC_FAUCET_AMOUNT = "100"; // USDC to send from server wallet
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const FRIENDBOT_POLICY = outboundPolicy({ allowedHosts: ["friendbot.stellar.org"] });

async function handler(req: NextRequest): Promise<NextResponse> {
  if (serverConfig.stellar.network !== "testnet") {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Faucet is only available on testnet" },
      { status: 403 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { publicKey } = await req.json();
  if (!publicKey || !/^G[A-Z2-7]{55}$/.test(publicKey)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Invalid Stellar public key" },
      { status: 400 }
    );
  }

  // Step 1 — fund XLM via Friendbot (creates account + adds XLM)
  const friendbotRes = await safeFetch(
    `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`,
    {},
    FRIENDBOT_POLICY
  );
  if (!friendbotRes.ok && friendbotRes.status !== 400) {
    // 400 from Friendbot means account already funded — that's fine
    const text = await friendbotRes.text();
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: `Friendbot error: ${text}` },
      { status: 502 }
    );
  }

  // Step 2 — send USDC from server wallet
  const txHash = await sendUsdcPayment(publicKey, USDC_FAUCET_AMOUNT);

  return NextResponse.json<ApiResponse<{ xlmFunded: boolean; usdcTxHash: string }>>({
    success: true,
    data: { xlmFunded: true, usdcTxHash: txHash },
  });
}

// 5 requests per 10 minutes per IP — enough for dev, prevents abuse
export const POST = withRateLimit(withErrorHandler(handler), {
  limit: 5,
  windowMs: 10 * 60 * 1000,
});
