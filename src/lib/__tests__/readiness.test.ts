jest.mock("@/lib/db", () => ({ query: jest.fn() }));
jest.mock("@/lib/redis", () => ({ getRedis: jest.fn() }));
import { checkReadiness, type ReadinessCheck } from "@/lib/readiness";

const ok = (name: string, critical = true): ReadinessCheck => ({ name, critical, run: async () => {} });
const fail = (name: string, critical = true): ReadinessCheck => ({
  name, critical, run: async () => { throw new Error("down"); },
});

describe("checkReadiness", () => {
  it("is ready when all checks pass", async () => {
    const r = await checkReadiness([ok("db"), ok("redis", false)]);
    expect(r.ready).toBe(true);
  });

  it("is not ready when a critical check fails", async () => {
    const r = await checkReadiness([fail("db"), ok("redis", false)]);
    expect(r.ready).toBe(false);
    expect(r.checks[0]).toMatchObject({ status: "error", error: "down" });
  });

  it("stays ready when only a non-critical check fails", async () => {
    const r = await checkReadiness([ok("db"), fail("redis", false)]);
    expect(r.ready).toBe(true);
  });

  it("times out hung dependencies", async () => {
    const hung: ReadinessCheck = { name: "db", critical: true, run: () => new Promise(() => {}) };
    const r = await checkReadiness([hung], 20);
    expect(r.ready).toBe(false);
    expect(r.checks[0].error).toMatch(/timed out/);
  });
});
