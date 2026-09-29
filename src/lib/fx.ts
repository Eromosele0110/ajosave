import axios from "axios";
import { getRedis } from "@/lib/redis";

const CACHE_KEY_PREFIX = "fx:per_usdc:";
const FALLBACK_KEY_PREFIX = "fx:per_usdc:last_known:";
const CACHE_TTL_SECONDS = 300; // 5 minutes
const HARDCODED_FALLBACKS: Record<string, number> = {
  NGN: 1600,
  GBP: 0.8,
  EUR: 0.9,
  USD: 1.0,
};

// Stellar DEX order-book: USDC (testnet issuer) / NGN (native proxy via XLM)
// We use the Horizon /order_book endpoint for USDC→XLM then a NGN/XLM rate.
// For simplicity we use exchangeratesapi or a public forex endpoint.
async function fetchLiveRate(currency: string): Promise<number> {
  // Use ExchangeRate-API (free tier, no key needed for basic endpoint)
  const { data } = await axios.get(
    "https://open.er-api.com/v6/latest/USD",
    { timeout: 5000, maxRedirects: 0 }
  );
  const rate: number = data.rates?.[currency];
  if (!rate) throw new Error(`${currency} rate missing from FX response`);
  // USDC ≈ 1 USD
  return rate;
}

export async function getFiatPerUsdc(currency: string): Promise<number> {
  const redis = await getRedis();
  const cacheKey = `${CACHE_KEY_PREFIX}${currency}`;
  const fallbackKey = `${FALLBACK_KEY_PREFIX}${currency}`;

  const cached = await redis.get(cacheKey);
  if (cached) return parseFloat(cached);

  try {
    const rate = await fetchLiveRate(currency);
    console.info(`[FX] Live ${currency}/USDC rate: ${rate}`);
    await redis.setEx(cacheKey, CACHE_TTL_SECONDS, String(rate));
    await redis.set(fallbackKey, String(rate)); // persist last known indefinitely
    return rate;
  } catch (err) {
    console.error(`[FX] Failed to fetch live rate for ${currency}, using fallback:`, err);
    const lastKnown = await redis.get(fallbackKey);
    const rate = lastKnown ? parseFloat(lastKnown) : (HARDCODED_FALLBACKS[currency] || 1.0);
    console.warn(`[FX] Fallback ${currency}/USDC rate: ${rate}`);
    return rate;
  }
}
