const kv = new Map<string, string>();

jest.mock("next/server", () => {
  class Res {
    status: number; body: unknown; headers: Map<string, string>;
    constructor(body: unknown, init?: { status?: number }) { this.body = body; this.status = init?.status ?? 200; this.headers = new Map(); }
    clone() { return this; }
    async json() { return this.body; }
  }
  return { NextRequest: class {}, NextResponse: { json: (b: unknown, i?: { status?: number }) => new Res(b, i) } };
});
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/logger", () => ({ __esModule: true, default: { warn: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn() }) } }));
jest.mock("@/lib/correlation", () => ({ runWithCorrelationId: (_id: string, fn: () => unknown) => fn() }));
jest.mock("@/lib/sanitize", () => ({ sanitizeBody: (b: unknown) => b }));
jest.mock("@/lib/errors", () => ({ isAppError: () => false, internalError: jest.fn() }));
jest.mock("next-auth/jwt", () => ({ getToken: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/sessions", () => ({ isSessionRevoked: jest.fn(), hashToken: (s: string) => s }));
jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(async () => ({
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string, o?: { NX?: boolean }) => {
      if (o?.NX && kv.has(k)) return null;
      kv.set(k, v);
      return "OK";
    },
    del: async (k: string) => { kv.delete(k); },
  })),
}));

import { withIdempotency } from "../index";

function req(body: string, key?: string, method = "POST") {
  const headers = new Map<string, string>(key ? [["idempotency-key", key]] : []);
  return {
    method,
    url: "http://x/api/v1/circles/c1/contribute",
    headers: { get: (h: string) => headers.get(h.toLowerCase()) ?? null },
    clone: () => ({ text: async () => body }),
  } as any;
}

beforeEach(() => kv.clear());

describe("withIdempotency", () => {
  it("replays the cached response for the same key and body", async () => {
    const handler = jest.fn(async () => ({ status: 201, headers: new Map(), clone() { return this; }, json: async () => ({ ok: 1 }) }) as any);
    const wrapped = withIdempotency(handler);
    await wrapped(req('{"a":1}', "key-12345678"));
    const second: any = await wrapped(req('{"a":1}', "key-12345678"));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("rejects key reuse with a different body", async () => {
    const handler = jest.fn(async () => ({ status: 200, headers: new Map(), clone() { return this; }, json: async () => ({}) }) as any);
    const wrapped = withIdempotency(handler);
    await wrapped(req('{"a":1}', "key-12345678"));
    const res: any = await wrapped(req('{"a":2}', "key-12345678"));
    expect(res.status).toBe(422);
  });

  it("rejects invalid and missing-but-required keys", async () => {
    const handler = jest.fn();
    expect(((await withIdempotency(handler)(req("{}", "bad"))) as any).status).toBe(400);
    expect(((await withIdempotency(handler, { required: true })(req("{}"))) as any).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 409 while a request is in flight", async () => {
    let release!: () => void;
    const handler = jest.fn(() => new Promise<any>((r) => { release = () => r({ status: 200, headers: new Map(), clone() { return this; }, json: async () => ({}) }); }));
    const wrapped = withIdempotency(handler);
    const first = wrapped(req("{}", "key-inflight1"));
    await new Promise((r) => setTimeout(r, 0));
    const second: any = await wrapped(req("{}", "key-inflight1"));
    expect(second.status).toBe(409);
    release();
    await first;
  });

  it("does not cache 5xx responses so retries run again", async () => {
    const handler = jest.fn(async () => ({ status: 503, headers: new Map(), clone() { return this; }, json: async () => ({}) }) as any);
    const wrapped = withIdempotency(handler);
    await wrapped(req("{}", "key-retry123"));
    await wrapped(req("{}", "key-retry123"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("passes through safe methods", async () => {
    const handler = jest.fn(async () => ({}) as any);
    await withIdempotency(handler)(req("", "key-12345678", "GET"));
    expect(handler).toHaveBeenCalled();
  });
});
