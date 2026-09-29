import { env } from "./env";

export const serverConfig = {
  app: {
    url: env.NEXT_PUBLIC_APP_URL,
    name: env.NEXT_PUBLIC_APP_NAME,
  },
  stellar: {
    network: env.STELLAR_NETWORK,
    horizonUrl: env.STELLAR_HORIZON_URL,
    horizonFallbackUrl: env.STELLAR_HORIZON_FALLBACK_URL,
    networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
    ajoContractId: env.STELLAR_AJO_CONTRACT_ID,
    certificateContractId: env.STELLAR_CERTIFICATE_CONTRACT_ID,
    serverSecretKey: env.STELLAR_SERVER_SECRET_KEY,
    sorobanRpcUrl: env.STELLAR_SOROBAN_RPC_URL,
    maxFeeCap: env.STELLAR_MAX_FEE_CAP,
  },
  usdc: {
    issuer: env.USDC_ISSUER,
    assetCode: env.USDC_ASSET_CODE,
    slippageTolerancePercent: env.SLIPPAGE_TOLERANCE_PERCENT,
  },
  paystack: {
    secretKey: env.PAYSTACK_SECRET_KEY,
    platformSubaccount: env.PAYSTACK_PLATFORM_SUBACCOUNT,
  },
  termii: {
    apiKey: env.TERMII_API_KEY,
    senderId: env.TERMII_SENDER_ID,
  },
  resend: {
    apiKey: env.RESEND_API_KEY,
    fromEmail: env.RESEND_FROM_EMAIL,
  },
  redis: { url: env.REDIS_URL },
  database: { url: env.DATABASE_URL },
  cronSecret: env.CRON_SECRET,
  authSecret: env.NEXTAUTH_SECRET || "development-secret-keep-it-safe",
  kyc: {
    smilePartnerId: env.SMILE_PARTNER_ID,
    smileApiKey: env.SMILE_API_KEY,
    smileCallbackUrl: env.SMILE_CALLBACK_URL,
    /** NGN threshold above which circles require KYC (default 100,000) */
    thresholdNgn: env.KYC_THRESHOLD_NGN,
  },
} as const;
