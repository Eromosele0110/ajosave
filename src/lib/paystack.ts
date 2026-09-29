import axios from "axios";
import { serverConfig } from "@/server/config";
import type { SupportedCurrency } from "@/types";
import { toSmallestUnit } from "./currency";
import { getCorrelationId } from "./correlation";

const client = axios.create({
  baseURL: "https://api.paystack.co",
  maxRedirects: 0,
  headers: { Authorization: `Bearer ${serverConfig.paystack.secretKey}` },
});

// Forward correlation ID on every outbound request
client.interceptors.request.use((config) => {
  const correlationId = getCorrelationId();
  if (correlationId) config.headers["x-correlation-id"] = correlationId;
  return config;
});

// Map our currency codes to Paystack currency codes
const PAYSTACK_CURRENCY_MAP: Record<SupportedCurrency, string> = {
  NGN: "NGN",
  GBP: "GBP",
  USD: "USD",
  EUR: "EUR", // Note: Paystack may not support EUR directly, may need alternative provider
};

/** Platform fee as a fraction (e.g. 0.005 = 0.5%). Configurable via PLATFORM_FEE_PERCENT. */
export const PLATFORM_FEE_RATE =
  parseFloat(process.env.PLATFORM_FEE_PERCENT ?? "0.5") / 100;

/**
 * Calculate the platform fee for a given amount.
 * Returns the fee in the same unit as `amount`.
 */
export function calculatePlatformFee(amount: number): number {
  return Math.round(amount * PLATFORM_FEE_RATE);
}

export async function initializePayment(params: {
  email: string;
  amount: number;
  currency: SupportedCurrency;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string; reference: string; platformFee: number }> {
  const amountInSmallestUnit = toSmallestUnit(params.amount, params.currency);
  const paystackCurrency = PAYSTACK_CURRENCY_MAP[params.currency];
  const platformFee = calculatePlatformFee(amountInSmallestUnit);

  const body: Record<string, unknown> = {
    email: params.email,
    amount: amountInSmallestUnit,
    currency: paystackCurrency,
    reference: params.reference,
    callback_url: params.callbackUrl,
    metadata: {
      ...params.metadata,
      platform_fee: platformFee,
      platform_fee_rate: PLATFORM_FEE_RATE,
    },
  };

  // Add split if platform subaccount is configured
  const platformSubaccount = serverConfig.paystack.platformSubaccount;
  if (platformSubaccount) {
    body.split = {
      type: "flat",
      bearer_type: "subaccount",
      subaccounts: [{ subaccount: platformSubaccount, share: platformFee }],
    };
  }

  const { data } = await client.post("/transaction/initialize", body);
  return {
    authorizationUrl: data.data.authorization_url,
    reference: data.data.reference,
    platformFee,
  };
}

export async function verifyPayment(
  reference: string
): Promise<{
  status: "success" | "failed" | "pending";
  amount: number;
  currency: string;
}> {
  const { data } = await client.get(`/transaction/verify/${reference}`);
  return {
    status: data.data.status,
    amount: data.data.amount,
    currency: data.data.currency,
  };
}
