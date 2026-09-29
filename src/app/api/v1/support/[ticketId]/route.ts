import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSupportTicketById } from "@/server/services/support.service";
import { withErrorHandler } from "@/server/middleware";
import { notFound } from "@/lib/errors";
import type { ApiResponse } from "@/types";
import type { SupportTicket } from "@/server/services/support.service";

/**
 * GET /api/v1/support/[ticketId]
 *
 * Fetch a single support ticket by ID.
 * Only the ticket's owner can view it (ownership enforced via user_id scoping).
 */
export const GET = withErrorHandler(
  async (req: NextRequest, ctx: { params: { ticketId: string } }) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = (session.user as { id: string }).id;
    const ticketId = ctx?.params?.ticketId;

    if (!ticketId) throw notFound("Ticket not found");

    const ticket = await getSupportTicketById(ticketId, userId);
    if (!ticket) throw notFound("Ticket not found");

    return NextResponse.json<ApiResponse<SupportTicket>>(
      { success: true, data: ticket },
      { status: 200 }
    );
  }
);
