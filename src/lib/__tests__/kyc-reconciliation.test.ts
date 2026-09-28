jest.mock("@/lib/db", () => ({ query: jest.fn() }));
jest.mock("@/lib/logger", () => ({ __esModule: true, default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
import { query } from "@/lib/db";
import { reconcileKycStatuses } from "@/lib/kyc-reconciliation";

const mockQuery = query as jest.Mock;

beforeEach(() => mockQuery.mockReset());

describe("reconcileKycStatuses", () => {
  it("applies provider results and tallies outcomes", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] })
      .mockResolvedValue({ rowCount: 1 });
    const results = { a: "approved", b: "rejected", c: null } as const;
    const lookup = jest.fn(async (id: string) => {
      if (!(id in results)) throw new Error("503");
      return results[id as keyof typeof results];
    });
    const s = await reconcileKycStatuses({ lookup });
    expect(s).toEqual({ scanned: 4, approved: 1, rejected: 1, stillPending: 1, skipped: 0, failed: 1 });
    // Only final statuses produce updates, each guarded on 'pending'
    const updates = mockQuery.mock.calls.slice(1);
    expect(updates).toHaveLength(2);
    for (const [sql] of updates) expect(sql).toMatch(/kyc_status = 'pending'/);
  });

  it("skips users resolved concurrently by a webhook", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "a" }] }).mockResolvedValueOnce({ rowCount: 0 });
    const s = await reconcileKycStatuses({ lookup: async () => "rejected" });
    expect(s).toMatchObject({ skipped: 1, rejected: 0 });
  });

  it("clamps staleness and batch limit", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await reconcileKycStatuses({ staleMinutes: -5, limit: 99999, lookup: async () => null });
    expect(mockQuery.mock.calls[0][1]).toEqual([1, 1000]);
  });
});
