import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateActivityStatement } from "@/server/services/activity-statement.service";
import { withErrorHandler } from "@/server/middleware";
import { badRequest } from "@/lib/errors";
import type { ApiResponse } from "@/types";
import type { ActivityStatement } from "@/server/services/activity-statement.service";

/**
 * GET /api/v1/users/me/activity-statement
 *
 * Returns a structured activity statement for the authenticated user covering
 * all confirmed contributions and payouts received. Supports optional date
 * range filtering via `?from=` and `?to=` ISO 8601 query parameters.
 *
 * Defaults to the trailing 365 days when no range is supplied.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = (session.user as { id: string }).id;
  const { searchParams } = new URL(req.url);

  let from: Date | undefined;
  let to: Date | undefined;

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  if (fromParam) {
    from = new Date(fromParam);
    if (isNaN(from.getTime())) throw badRequest("Invalid 'from' date");
  }
  if (toParam) {
    to = new Date(toParam);
    if (isNaN(to.getTime())) throw badRequest("Invalid 'to' date");
  }
  if (from && to && from > to) {
    throw badRequest("'from' must be before 'to'");
  }

  const statement = await generateActivityStatement(userId, { from, to });

  return NextResponse.json<ApiResponse<ActivityStatement>>(
    { success: true, data: statement },
    { status: 200 }
  );
});
