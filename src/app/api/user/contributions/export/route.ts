import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { withErrorHandler } from "@/server/middleware";
import { createCsvStream, exportResponseHeaders } from "@/lib/streaming-export";

interface ExportRow {
  date: string;
  circleName: string;
  amountUsdc: string;
  status: string;
}

const COLUMNS = [
  { key: "date", header: "Date" },
  { key: "circleName", header: "Circle Name" },
  { key: "amountUsdc", header: "Amount (USDC)" },
  { key: "status", header: "Status" },
] as const;

/**
 * GET /api/user/contributions/export
 *
 * Streams the caller's contribution history as CSV. Nothing is written to disk or object
 * storage, so there is no export artifact to clean up; the response is marked `no-store` so
 * no browser or proxy keeps a copy either. Accounts that have been deleted (#110) get an
 * empty export even if a stale session is still presented.
 */
export const GET = withErrorHandler(async (_req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const { rows } = await query<ExportRow>(
    `SELECT
       c.created_at       AS date,
       ci.name            AS "circleName",
       c.amount_usdc      AS "amountUsdc",
       c.status
     FROM contributions c
     JOIN members m  ON m.id = c.member_id
     JOIN users u    ON u.id = m.user_id AND u.deleted_at IS NULL
     JOIN circles ci ON ci.id = c.circle_id
     WHERE m.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId]
  );

  const records = rows.map((r) => ({
    date: new Date(r.date).toISOString().split("T")[0],
    circleName: r.circleName,
    amountUsdc: parseFloat(r.amountUsdc).toFixed(2),
    status: r.status,
  }));

  const filename = `contributions-${new Date().toISOString().split("T")[0]}`;
  return new NextResponse(createCsvStream(records, { columns: [...COLUMNS] }), {
    status: 200,
    headers: exportResponseHeaders(filename),
  });
});
