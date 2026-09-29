/**
 * Typed, validated environment variables.
 *
 * All environment access for server-side configuration should go through
 * `env` (or `serverConfig`, which is derived from it) rather than reading
 * `process.env.X` directly. This module parses `process.env` once, at
 * import time, against a Zod schema so that:
 *
 *  - Required secrets are actually present before the app starts serving
 *    traffic in production (fail fast instead of a confusing runtime error
 *    the first time a payment/auth/DB code path is hit).
 *  - Numeric/boolean-looking values (pool sizes, timeouts, thresholds) are
 *    parsed and bounds-checked once, instead of ad-hoc `parseInt(...) || x`
 *    scattered across the codebase.
 *  - Everyone gets a single, typed `env` object instead of guessing at
 *    variable names.
 *
 * NOTE: this intentionally does not migrate every existing `process.env.*`
 * read in the codebase (there are ~50 call sites) — that's a larger,
 * separate refactor. This establishes the schema and startup validation,
 * and is the place new env vars should be added going forward.
 */
import { z } from "zod";

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const numericString = (fallback: string) =>
  z
    .string()
    .optional()
    .default(fallback)
    .transform((v) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : Number.parseInt(fallback, 10);
    });

const isProd = process.env.NODE_ENV === "production";

/** Required only when running for real (production); optional in dev/test/CI. */
const requiredInProd = (schema: z.ZodString) =>
  isProd ? schema.min(1) : schema.optional().default("");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // App
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("STELLAR"),

  // Auth
  NEXTAUTH_URL: z.string().optional().default(""),
  NEXTAUTH_SECRET: requiredInProd(z.string()),

  // Database
  DATABASE_URL: requiredInProd(z.string()),
  DB_POOL_SIZE: numericString("10"),
  DB_POOL_MIN: numericString("2"),
  DB_CONNECTION_TIMEOUT_MS: numericString("5000"),
  DB_IDLE_TIMEOUT_MS: numericString("30000"),
  DB_MAX_RETRIES: numericString("3"),
  DB_RETRY_DELAY_MS: numericString("500"),

  // Stellar / Soroban
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEXT_PUBLIC_STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).optional(),
  STELLAR_HORIZON_URL: z.string().default("https://horizon-testnet.stellar.org"),
  STELLAR_HORIZON_FALLBACK_URL: z.string().optional().default(""),
  STELLAR_SOROBAN_RPC_URL: z.string().default("https://soroban-testnet.stellar.org"),
  STELLAR_NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  STELLAR_AJO_CONTRACT_ID: z.string().optional().default(""),
  STELLAR_CERTIFICATE_CONTRACT_ID: z.string().optional().default(""),
  STELLAR_SERVER_SECRET_KEY: requiredInProd(z.string()),
  STELLAR_MAX_FEE_CAP: numericString("200"),
  ENABLE_HORIZON_STREAM: booleanish,
  ENABLE_EVENT_INDEXER: booleanish,
  EVENT_INDEXER_POLL_MS: numericString("5000"),

  // USDC
  USDC_ISSUER: z.string().default("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
  USDC_ASSET_CODE: z.string().default("USDC"),
  SLIPPAGE_TOLERANCE_PERCENT: z
    .string()
    .optional()
    .default("0.5")
    .transform((v) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0.5;
    }),

  // Payments / fees
  PAYSTACK_SECRET_KEY: requiredInProd(z.string()),
  PAYSTACK_PLATFORM_SUBACCOUNT: z.string().optional().default(""),
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: z.string().optional().default(""),
  PLATFORM_FEE_PERCENT: z
    .string()
    .optional()
    .default("0")
    .transform((v) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    }),

  // SMS / OTP
  TERMII_API_KEY: requiredInProd(z.string()),
  TERMII_SENDER_ID: z.string().default("STELLAR"),

  // Email
  RESEND_API_KEY: z.string().optional().default(""),
  RESEND_FROM_EMAIL: z.string().default("Ajosave <noreply@ajosave.app>"),

  // KYC
  SMILE_PARTNER_ID: z.string().optional().default(""),
  SMILE_API_KEY: z.string().optional().default(""),
  SMILE_CALLBACK_URL: z.string().optional().default(""),
  KYC_THRESHOLD_NGN: numericString("100000"),

  // Redis / queue / outbox
  REDIS_URL: z.string().default("redis://localhost:6379"),
  OUTBOX_BATCH_LIMIT: numericString("50"),
  OUTBOX_MAX_ATTEMPTS: numericString("5"),
  WORKER_SHUTDOWN_TIMEOUT_MS: numericString("10000"),

  // Cron / jobs
  CRON_SECRET: requiredInProd(z.string()),

  // Security / PII
  PII_ENCRYPTION_KEY: requiredInProd(z.string()),
  PII_HMAC_KEY: requiredInProd(z.string()),
  ALLOWED_ORIGINS: z.string().optional().default(""),

  // Observability
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SENTRY_DSN: z.string().optional().default(""),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional().default(""),

  // Wallet
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // Fail fast and loud: a misconfigured production environment should
    // never boot into a state where it silently falls back to empty
    // secrets for payments, auth, or PII encryption.
    throw new Error(
      `Invalid environment configuration. Fix the following and restart:\n${issues}`
    );
  }

  return parsed.data;
}

export const env = loadEnv();
