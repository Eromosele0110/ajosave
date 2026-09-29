/**
 * KYC integration — Issue #129
 *
 * Thin wrapper around the Smile Identity Web API v2.
 * Flow:
 *   1. Client calls POST /api/v1/kyc/verify  → server calls initiateKyc()
 *      → returns a Smile Identity web-token the client uses to open the widget.
 *   2. Smile Identity calls POST /api/v1/kyc/webhook with the result.
 *   3. handleKycWebhook() verifies the HMAC signature and upserts kyc_status.
 *
 * Required env vars:
 *   SMILE_PARTNER_ID    — your Smile Identity partner ID
 *   SMILE_API_KEY       — Smile Identity API key (used for HMAC verification)
 *   SMILE_CALLBACK_URL  — full URL to /api/v1/kyc/webhook
 */
import { createHmac } from "crypto";
import { query } from "./db";

const BASE_URL = "https://testapi.smileidentity.com/v1";

export type KycStatus = "none" | "pending" | "approved" | "rejected";

/** Initiate a KYC session; returns the web-token for the Smile Identity widget. */
export async function initiateKyc(userId: string): Promise<{ token: string }> {
  const partnerId = requireEnv("SMILE_PARTNER_ID");
  const apiKey = requireEnv("SMILE_API_KEY");
  const callbackUrl = requireEnv("SMILE_CALLBACK_URL");

  const res = await fetch(`${BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partner_id: partnerId,
      api_key: apiKey,
      callback_url: callbackUrl,
      user_id: userId,
      product: "ekyc_smartselfie",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Smile Identity token request failed: ${text}`);
  }

  const data = (await res.json()) as { token: string };

  // Mark user as pending
  await query(
    "UPDATE users SET kyc_status = 'pending', kyc_submitted_at = NOW() WHERE id = $1 AND kyc_status <> 'approved'",
    [userId]
  );

  return { token: data.token };
}

export interface SmileWebhookPayload {
  ResultCode: string;       // "1012" = Approved, "1020" = Rejected, etc.
  PartnerParams: { user_id: string };
  signature: string;
  timestamp: string;
}

/**
 * Verify the Smile Identity HMAC signature and update kyc_status.
 * Returns the resolved status so the route can respond accordingly.
 */
export async function handleKycWebhook(
  payload: SmileWebhookPayload
): Promise<{ userId: string; status: KycStatus }> {
  const apiKey = requireEnv("SMILE_API_KEY");
  const partnerId = requireEnv("SMILE_PARTNER_ID");

  // Smile Identity signature: HMAC-SHA256 of "timestamp:partner_id"
  const expected = createHmac("sha256", apiKey)
    .update(`${payload.timestamp}:${partnerId}`)
    .digest("base64");

  if (expected !== payload.signature) {
    throw new Error("Invalid Smile Identity webhook signature");
  }

  const userId = payload.PartnerParams.user_id;
  // ResultCode "1012" = Approved; anything else is treated as rejected
  const status: KycStatus = payload.ResultCode === "1012" ? "approved" : "rejected";

  await query(
    `UPDATE users
     SET kyc_status = $1, kyc_verified_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END
     WHERE id = $2`,
    [status, userId]
  );

  return { userId, status };
}

/** Returns the current KYC status for a user. */
export async function getKycStatus(userId: string): Promise<KycStatus> {
  const { rows } = await query<{ kyc_status: KycStatus }>(
    "SELECT kyc_status FROM users WHERE id = $1",
    [userId]
  );
  return rows[0]?.kyc_status ?? "none";
}

/** True if the user has approved KYC. */
export async function isKycVerified(userId: string): Promise<boolean> {
  return (await getKycStatus(userId)) === "approved";
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}
