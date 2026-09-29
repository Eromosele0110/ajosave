jest.mock("@/lib/db", () => ({ query: jest.fn() }));
jest.mock("@/lib/logger", () => ({ __esModule: true, default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
import { query } from "@/lib/db";
import { applyPolicy, MAX_BATCHES_PER_RUN, POLICIES, runRetention, validatePolicy } from "@/lib/retention";

const mockQuery = query as jest.Mock;
const policy = { table: "sms_logs", column: "created_at", days: 90 };

beforeEach(() => mockQuery.mockReset());

describe("retention", () => {
  it("never targets financial or audit tables", () => {
    const tables = POLICIES.map((p) => p.table);
    for (const t of ["contributions", "payouts", "audit_logs", "users", "circles"]) expect(tables).not.toContain(t);
  });

  it("rejects too-short windows and unsafe identifiers", () => {
    expect(() => validatePolicy({ ...policy, days: 1 })).toThrow();
    expect(() => validatePolicy({ ...policy, table: "users; DROP TABLE x" })).toThrow();
  });

  it("dry run counts without deleting", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: "12" }] });
    const r = await applyPolicy(policy, { dryRun: true });
    expect(r).toMatchObject({ deleted: 12, dryRun: true });
    expect(mockQuery.mock.calls[0][0]).toMatch(/^SELECT COUNT/);
  });

  it("deletes in batches until a short batch", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 10 }).mockResolvedValueOnce({ rowCount: 3 });
    const r = await applyPolicy(policy, { batchSize: 10 });
    expect(r).toMatchObject({ deleted: 13, truncated: false });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("caps batches per run and reports truncation", async () => {
    mockQuery.mockResolvedValue({ rowCount: 5 });
    const r = await applyPolicy(policy, { batchSize: 5 });
    expect(r.truncated).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(MAX_BATCHES_PER_RUN);
  });

  it("continues past a failing policy", async () => {
    mockQuery.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ rowCount: 0 });
    const r = await runRetention({ policies: [policy, { ...policy, table: "sessions" }] });
    expect(r[0].error).toBe("boom");
    expect(r[1]).toMatchObject({ table: "sessions", deleted: 0 });
  });
});
