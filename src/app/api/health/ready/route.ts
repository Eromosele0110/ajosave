import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/readiness";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

/** GET /api/health/ready — 200 when all critical dependencies are reachable, else 503. */
export async function GET() {
  const result = await checkReadiness();
  if (!result.ready) {
    logger.warn({ checks: result.checks.filter((c) => c.status !== "ok") }, "[readiness] not ready");
  }
  return NextResponse.json(
    { status: result.ready ? "ready" : "not_ready", timestamp: new Date().toISOString(), ...result },
    { status: result.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
