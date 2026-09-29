/**
 * GET /api/v1/invite/[token]
 *
 * Validate an invite token without consuming it.
 * Returns circle information so the UI can show a preview before the user
 * accepts the invite.
 *
 * POST /api/v1/invite/[token]
 *
 * Accept (consume) an invite token and join the circle.
 * Atomically marks the token as used and calls joinCircle().
 * Fails with 409 if the token has already been used or expired.
 *
 * Issue #117 — Expiring invite links
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { validateInviteToken, consumeInviteToken } from "@/lib/tokens";
import { getCircleById, joinCircle } from "@/server/services/circle.service";
import { withErrorHandler, withRateLimit } from "@/server/middleware";
import type { ApiResponse, Circle } from "@/types";

export interface InvitePreviewResponse {
  valid: true;
  circle: Pick<Circle, "id" | "name" | "maxMembers" | "cycleFrequency" | "contributionNgn" | "status">;
  expiresAt: string; // ISO-8601
}

/** GET — preview invite without consuming */
export const GET = withRateLimit(
  withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
    const { params } = ctx as { params: { token: string } };
    const tokenRecord = await validateInviteToken(params.token);

    if (!tokenRecord) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Invite link is invalid, expired, or has already been used", code: "INVITE_INVALID" },
        { status: 410 }
      );
    }

    const circle = await getCircleById(tokenRecord.circleId);
    if (!circle) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Circle not found" },
        { status: 404 }
      );
    }

    if (circle.status !== "open") {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "This circle is no longer accepting new members", code: "CIRCLE_CLOSED" },
        { status: 409 }
      );
    }

    return NextResponse.json<ApiResponse<InvitePreviewResponse>>({
      success: true,
      data: {
        valid: true,
        circle: {
          id: circle.id,
          name: circle.name,
          maxMembers: circle.maxMembers,
          cycleFrequency: circle.cycleFrequency,
          contributionNgn: circle.contributionNgn,
          status: circle.status,
        },
        expiresAt: tokenRecord.expiresAt.toISOString(),
      },
    });
  }),
  { limit: 60, windowMs: 60_000 }
);

/** POST — accept invite and join circle */
export const POST = withRateLimit(
  withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = (session.user as { id: string }).id;
    const { params } = ctx as { params: { token: string } };

    // Atomically consume the token
    const tokenRecord = await consumeInviteToken(params.token, userId);

    if (!tokenRecord) {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: "Invite link is invalid, expired, or has already been used",
          code: "INVITE_INVALID",
        },
        { status: 410 }
      );
    }

    // Join the circle using the consumed token
    try {
      const member = await joinCircle(tokenRecord.circleId, userId, /* isInvited */ true);
      return NextResponse.json(
        { success: true, data: { joined: true, circleId: tokenRecord.circleId, member } },
        { status: 201 }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join circle";
      // Map domain errors to appropriate HTTP statuses
      if (message.includes("not found")) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: message },
          { status: 404 }
        );
      }
      if (message.includes("full") || message.includes("Already a member") || message.includes("not open")) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: message, code: "CIRCLE_CLOSED" },
          { status: 409 }
        );
      }
      throw err; // let withErrorHandler convert it to 500
    }
  }),
  { limit: 10, windowMs: 60_000 }
);
