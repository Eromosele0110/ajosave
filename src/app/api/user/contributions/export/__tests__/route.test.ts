/**
 * @jest-environment node
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/db", () => ({ query: jest.fn() }));
jest.mock("@/server/middleware", () => ({
  withErrorHandler: (handler: Function) => handler,
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { GET } from "../route";

const mockSession = getServerSession as jest.Mock;
const mockQuery = query as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ user: { id: "user-1" } });
});

describe("GET /api/user/contributions/export", () => {
  it("returns 401 without a session and never queries", async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET({} as any);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("streams a CSV that browsers and proxies must not cache", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          date: "2026-03-01T10:00:00Z",
          circleName: "Family Ajo",
          amountUsdc: "25",
          status: "confirmed",
        },
      ],
    });
    const res = await GET({} as any);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Pragma")).toBe("no-cache");
    expect(res.headers.get("Expires")).toBe("0");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="contributions-\d{4}-\d{2}-\d{2}\.csv"$/
    );

    const text = await res.text();
    expect(text.split("\r\n")).toEqual([
      "Date,Circle Name,Amount (USDC),Status",
      "2026-03-01,Family Ajo,25.00,confirmed",
      "",
    ]);
  });

  it("neutralises spreadsheet formulas in user-controlled circle names", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          date: "2026-03-01T10:00:00Z",
          circleName: '=HYPERLINK("http://evil","x")',
          amountUsdc: "1",
          status: "confirmed",
        },
        {
          date: "2026-03-02T10:00:00Z",
          circleName: "@SUM(A1)",
          amountUsdc: "1",
          status: "confirmed",
        },
      ],
    });
    const text = await (await GET({} as any)).text();
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(text).toContain("'@SUM(A1)");
    expect(text).not.toMatch(/,=HYPERLINK/);
  });

  it("quotes cells containing commas, quotes and newlines", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          date: "2026-03-01T10:00:00Z",
          circleName: 'A, "B"\nC',
          amountUsdc: "1",
          status: "confirmed",
        },
      ],
    });
    const text = await (await GET({} as any)).text();
    expect(text).toContain('"A, ""B""\nC"');
  });

  it("only exports rows of the caller and never of a deleted account", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await GET({} as any);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("u.deleted_at IS NULL");
    expect(sql).toContain("m.user_id = $1");
    expect(params).toEqual(["user-1"]);
    expect(await res.text()).toBe("Date,Circle Name,Amount (USDC),Status\r\n");
  });
});
