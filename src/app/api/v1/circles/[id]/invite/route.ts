/**
 * POST /api/v1/circles/[id]/invite
 *
 * Generate a single-use, 48-hour expiry invite link for a circle.
 * Only the circle creator may generate invite links.
 *
 * Issue #117 — Expiring invite links
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCircleById } from "@/server/services/circle.service";
import { generateInviteToken } from "@/lib/tokens";
import { withErrorHandler, withRateLimit } from "@/server/middleware";
import { serverConfig } from "@/server/config";
import type { ApiResponse } from "@/types";

export interface InviteLinkResponse {
  inviteUrl: string;
  expiresAt: string; // ISO-8601
}

export const POST = withRateLimit(
  withErrorHandler(async (req: NextRequest, ctx: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { params } = ctx as { params: { id: string } };
    const circle = await getCircleById(params.id);

    if (!circle) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Circle not found" },
        { status: 404 }
      );
    }

    const userId = (session.user as { id: string }).id;

    // Only the circle creator can generate invite links
    if (circle.creatorId !== userId) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Only the circle creator can generate invite links" },
        { status: 403 }
      );
    }

    // Circles that are no longer open cannot accept new members
    if (circle.status !== "open") {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Invite links can only be created for open circles" },
        { status: 409 }
      );
    }

    // Parse optional expiresInHours from body (default: 48)
    let expiresInHours = 48;
    try {
      const body = await req.json().catch(() => ({}));
      if (typeof body.expiresInHours === "number" && body.expiresInHours > 0) {
        expiresInHours = Math.min(body.expiresInHours, 168); // cap at 7 days
      }
    } catch {
      // Body is optional; use default
    }

    const token = await generateInviteToken(circle.id, userId, expiresInHours);
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    const inviteUrl = `${serverConfig.app.url}/invite/${token}`;

    return NextResponse.json<ApiResponse<InviteLinkResponse>>(
      { success: true, data: { inviteUrl, expiresAt: expiresAt.toISOString() } },
      { status: 201 }
    );
  }),
  { limit: 20, windowMs: 60_000 }
);

// Keep GET for backward compatibility (legacy JWT token invite flow)
export const GET = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = ctx as { params: { id: string } };
  const circle = await getCircleById(params.id);

  if (!circle) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Circle not found" },
      { status: 404 }
    );
  }

  const userId = (session.user as { id: string }).id;
  if (circle.creatorId !== userId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Only the circle creator can generate invite links" },
      { status: 403 }
    );
  }

  // Use the new DB-backed flow for GET requests too
  const token = await generateInviteToken(circle.id, userId);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const inviteUrl = `${serverConfig.app.url}/invite/${token}`;

  return NextResponse.json<ApiResponse<InviteLinkResponse>>({
    success: true,
    data: { inviteUrl, expiresAt: expiresAt.toISOString() },
  });
});
