jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}));

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import logger from "@/lib/logger";
import { withAuthorization, resolveUser } from "../authorization";

const session = getServerSession as jest.Mock;
const req = { url: "http://localhost/api/circles/c1", method: "POST" } as never;
const ok = () => jest.fn(async () => NextResponse.json({ ok: true }));

describe("withAuthorization", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes the resolved user to the handler", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "admin" } });
    const handler = ok();
    const res = (await withAuthorization(handler)(req, { params: { id: "c1" } })) as any;
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, {
      params: { id: "c1" },
      user: { id: "u1", role: "admin" },
    });
  });

  it("returns 401 without a session", async () => {
    session.mockResolvedValue(null);
    const handler = ok();
    const res = (await withAuthorization(handler)(req)) as any;
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
    expect(handler).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "authz.denied", reason: "unauthenticated" })
    );
  });

  it("returns 401 for a session user without an id", async () => {
    session.mockResolvedValue({ user: { name: "x" } });
    expect(((await withAuthorization(ok())(req)) as any).status).toBe(401);
  });

  it("fails closed with 401 when the session lookup throws", async () => {
    session.mockRejectedValue(new Error("redis down"));
    const handler = ok();
    expect(((await withAuthorization(handler)(req)) as any).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the role is not allowed", async () => {
    session.mockResolvedValue({ user: { id: "u1" } });
    const res = (await withAuthorization(ok(), { roles: ["admin"] })(req)) as any;
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("returns 403 when the resource check fails or throws", async () => {
    session.mockResolvedValue({ user: { id: "u1" } });
    const denied = await withAuthorization(ok(), { check: () => false })(req);
    expect((denied as any).status).toBe(403);
    const throwing = () => {
      throw new Error("db");
    };
    const errored = await withAuthorization(ok(), { check: throwing })(req);
    expect((errored as any).status).toBe(403);
  });

  it("allows when the resource check passes", async () => {
    session.mockResolvedValue({ user: { id: "u1" } });
    const check = jest.fn(
      async (user: { id: string }, _r: unknown, ctx: any) => ctx.params.userId === user.id
    );
    const res = (await withAuthorization(ok(), { check })(req, {
      params: { userId: "u1" },
    })) as any;
    expect(res.status).toBe(200);
  });

  it("defaults the role to member and rejects blank ids", () => {
    expect(resolveUser({ user: { id: "u1" } })).toEqual({ id: "u1", role: "member" });
    expect(resolveUser({ user: { id: "  " } })).toBeNull();
  });
});
