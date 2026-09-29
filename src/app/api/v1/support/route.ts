import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createSupportTicket,
  getSupportTicketsByUser,
  isValidCategory,
  VALID_CATEGORIES,
} from "@/server/services/support.service";
import { withErrorHandler } from "@/server/middleware";
import { badRequest } from "@/lib/errors";
import type { ApiResponse } from "@/types";
import type { SupportTicket } from "@/server/services/support.service";

/**
 * POST /api/v1/support
 *
 * Submit a new support intake ticket.
 *
 * Body:
 *   category    — one of: payment_issue | circle_dispute | account_access |
 *                          payout_issue | general | other
 *   subject     — 5–200 characters
 *   description — 10–5 000 characters
 *   circleId    — optional UUID, attach the ticket to a specific circle
 *
 * Returns 201 with the created ticket on success.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = (session.user as { id: string }).id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }

  const { category, subject, description, circleId } = body as Record<string, unknown>;

  // ── Validate category ──────────────────────────────────────────────────────
  if (typeof category !== "string" || !isValidCategory(category)) {
    throw badRequest("Invalid or missing category", { validValues: [...VALID_CATEGORIES] });
  }

  // ── Validate subject ───────────────────────────────────────────────────────
  if (typeof subject !== "string" || subject.trim().length < 5) {
    throw badRequest("subject must be at least 5 characters");
  }
  if (subject.trim().length > 200) {
    throw badRequest("subject must be at most 200 characters");
  }

  // ── Validate description ───────────────────────────────────────────────────
  if (typeof description !== "string" || description.trim().length < 10) {
    throw badRequest("description must be at least 10 characters");
  }
  if (description.trim().length > 5000) {
    throw badRequest("description must be at most 5 000 characters");
  }

  // ── Optional circleId ──────────────────────────────────────────────────────
  const resolvedCircleId =
    typeof circleId === "string" && circleId.trim().length > 0 ? circleId.trim() : undefined;

  const ticket = await createSupportTicket({
    userId,
    category,
    subject,
    description,
    circleId: resolvedCircleId,
  });

  return NextResponse.json<ApiResponse<SupportTicket>>(
    { success: true, data: ticket },
    { status: 201 }
  );
});

/**
 * GET /api/v1/support
 *
 * List all support tickets submitted by the authenticated user, newest first.
 */
export const GET = withErrorHandler(async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = (session.user as { id: string }).id;
  const tickets = await getSupportTicketsByUser(userId);

  return NextResponse.json<ApiResponse<SupportTicket[]>>(
    { success: true, data: tickets },
    { status: 200 }
  );
});
