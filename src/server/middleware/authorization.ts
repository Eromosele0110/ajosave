import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import logger from "@/lib/logger";
import type { ApiError } from "@/types";

/**
 * Consistent API authorization.
 *
 * Every protected route should go through `withAuthorization` so that
 * unauthenticated and unauthorized requests get the same status codes, error
 * bodies and audit log lines everywhere:
 *
 *   401 UNAUTHORIZED — no session, or a session without a user id
 *   403 FORBIDDEN    — authenticated but missing a required role, or failing
 *                      the route's resource check (e.g. not the owner)
 *
 * Usage:
 *   export const GET = withAuthorization(handler, { roles: ["admin"] });
 *   export const PATCH = withAuthorization(handler, {
 *     check: (user, req, ctx) => ctx.params.userId === user.id,
 *   });
 */

export interface AuthorizedUser {
  id: string;
  role: string;
}

export interface AuthorizationContext {
  params?: Record<string, string>;
  user: AuthorizedUser;
  [key: string]: unknown;
}

type AuthorizedHandler = (_req: NextRequest, _ctx: AuthorizationContext) => Promise<NextResponse>;

type RouteHandler = (_req: NextRequest, _ctx?: any) => Promise<NextResponse>;

export interface AuthorizationOptions {
  /** Roles allowed to call the route. Omit to allow any authenticated user. */
  roles?: readonly string[];
  /** Resource-level check, e.g. ownership. Return false to reject with 403. */
  check?: (
    _user: AuthorizedUser,
    _req: NextRequest,
    _ctx: AuthorizationContext
  ) => boolean | Promise<boolean>;
}

export const DEFAULT_ROLE = "member";

function deny(status: 401 | 403): NextResponse {
  const body: ApiError =
    status === 401
      ? { success: false, error: "Unauthorized", code: "UNAUTHORIZED" }
      : { success: false, error: "Forbidden", code: "FORBIDDEN" };
  return NextResponse.json<ApiError>(body, { status });
}

/** Extract a trusted user from a session, or null if it is missing or malformed. */
export function resolveUser(session: unknown): AuthorizedUser | null {
  const user = (session as { user?: { id?: unknown; role?: unknown } } | null)?.user;
  if (!user || typeof user.id !== "string" || user.id.trim() === "") return null;
  const role = typeof user.role === "string" && user.role ? user.role : DEFAULT_ROLE;
  return { id: user.id, role };
}

export function withAuthorization(
  handler: AuthorizedHandler,
  options: AuthorizationOptions = {}
): RouteHandler {
  return async (req, ctx) => {
    const path = new URL(req.url).pathname;
    let session: unknown;
    try {
      session = await getServerSession(authOptions);
    } catch (err) {
      // Fail closed: a broken session store must never grant access.
      logger.error({ msg: "authz.session_error", path, err });
      return deny(401);
    }

    const user = resolveUser(session);
    if (!user) {
      logger.warn({ msg: "authz.denied", reason: "unauthenticated", path, method: req.method });
      return deny(401);
    }

    if (options.roles && !options.roles.includes(user.role)) {
      logger.warn({
        msg: "authz.denied",
        reason: "role",
        path,
        method: req.method,
        userId: user.id,
        role: user.role,
      });
      return deny(403);
    }

    const authCtx: AuthorizationContext = { ...(ctx ?? {}), user };

    if (options.check) {
      let allowed: boolean;
      try {
        allowed = (await options.check(user, req, authCtx)) === true;
      } catch (err) {
        logger.error({ msg: "authz.check_error", path, userId: user.id, err });
        allowed = false;
      }
      if (!allowed) {
        logger.warn({
          msg: "authz.denied",
          reason: "check",
          path,
          method: req.method,
          userId: user.id,
        });
        return deny(403);
      }
    }

    return handler(req, authCtx);
  };
}
