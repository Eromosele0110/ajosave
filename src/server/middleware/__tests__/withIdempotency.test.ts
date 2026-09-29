jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: { json: jest.fn((body, init) => ({ status: init?.status ?? 200, json: async () => body, clone: () => ({ json: async () => body }), headers: { set: jest.fn() } })) },
}));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/correlation", () => ({ runWithCorrelationId: (_id: string, fn: Function) => fn() }));
jest.mock("@/lib/logger", () => ({ __esModule: true, default: { warn: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn() }) } }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("next-auth/jwt", () => ({ getToken: jest.fn() }));
jest.mock("@/lib/sessions", () => ({ isSessionRevoked: jest.fn(), hashToken: (s: string) => s }));
jest.mock("@/lib/sanitize", () => ({ sanitizeBody: (b: unknown) => b }));
jest.mock("@/lib/errors", () => ({ isAppError: () => false, internalError: jest.fn() }));

const store = new Map<string, string>();

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(() =>
    Promise.resolve({
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, value: string, opts?: { NX?: boolean }) => {
        if (opts?.NX && store.has(key)) return Promise.resolve(null);
        store.set(key, value);
        return Promise.resolve("OK");
      },
      del: (key: string) => { store.delete(key); return Promise.resolve(1); },
    })
  ),
}));

import { withIdempotency } from "../index";
import { NextResponse } from "next/server";

beforeEach(() => store.clear());

const makeReq = (idempotencyKey?: string) => ({
  headers: { get: (h: string) => (h === "x-idempotency-key" ? idempotencyKey ?? null : null) },
  url: "http://localhost/test",
  method: "POST",
  clone: () => ({ text: async () => "{}" }),
});

const cachedKeys = () => [...store.keys()].filter((k) => !k.endsWith(":lock"));

const makeHandler = (status = 200, body = { success: true }) =>
  jest.fn().mockResolvedValue(
    NextResponse.json(body, { status })
  );

describe("withIdempotency", () => {
  it("passes through when no X-Idempotency-Key header", async () => {
    const handler = makeHandler();
    const wrapped = withIdempotency(handler);
    await wrapped(makeReq() as any);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls handler and caches response on first request", async () => {
    const handler = makeHandler(200, { success: true, data: { ref: "abc" } });
    const wrapped = withIdempotency(handler);
    await wrapped(makeReq("key-0001") as any);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cachedKeys()).toHaveLength(1);
  });

  it("returns cached response on duplicate request without calling handler", async () => {
    const handler = makeHandler(201, { success: true, data: { ref: "xyz" } });
    const wrapped = withIdempotency(handler);

    // First request — populates cache
    await wrapped(makeReq("key-0002") as any);
    expect(handler).toHaveBeenCalledTimes(1);

    // Second request — should hit cache
    const res = await wrapped(makeReq("key-0002") as any);
    expect(handler).toHaveBeenCalledTimes(1); // not called again
    expect(res.status).toBe(201);
  });

  it("different keys are cached independently", async () => {
    const handler = makeHandler();
    const wrapped = withIdempotency(handler);
    await wrapped(makeReq("key-000a") as any);
    await wrapped(makeReq("key-000b") as any);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(cachedKeys()).toHaveLength(2);
  });
});
