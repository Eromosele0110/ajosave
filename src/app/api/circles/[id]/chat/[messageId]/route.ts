import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { withErrorHandler } from "@/server/middleware";
import { deleteMessage } from "@/server/services/chat.service";
import { logAuditAction } from "@/server/services/audit.service";
import type { ApiResponse } from "@/types";

// ─── DELETE /api/circles/[id]/chat/[messageId] ────────────────────────────────
//
// Moderation boundary (#41): only the message's own author, or the circle's
// creator (the circle admin), may remove a message. Any other active member
// is forbidden — this is the actual boundary the issue title refers to on
// top of the existing chat feature (src/server/services/chat.service.ts).

export const DELETE = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = ctx as { params: { id: string; messageId: string } };
  const circleId = params.id;
  const messageId = params.messageId;
  const userId = (session.user as { id: string }).id;

  // Verify the requesting user is an active member of this circle
  const { rows: memberRows } = await query<{ exists: boolean }>(
    `SELECT 1 FROM members WHERE circle_id = $1 AND user_id = $2 AND status = 'active'`,
    [circleId, userId]
  );
  if (memberRows.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Forbidden" },
      { status: 403 }
    );
  }

  try {
    await deleteMessage(circleId, messageId, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete message";
    const status = message === "Message not found" ? 404 : message === "Forbidden" ? 403 : 400;
    return NextResponse.json<ApiResponse<never>>({ success: false, error: message }, { status });
  }

  await logAuditAction(userId, "DELETE_MESSAGE", "MESSAGE", messageId, {
    details: { circleId },
  });

  return new NextResponse(null, { status: 204 });
});
