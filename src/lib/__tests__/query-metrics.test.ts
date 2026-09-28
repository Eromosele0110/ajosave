jest.mock("@/lib/logger", () => ({ __esModule: true, default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
import logger from "@/lib/logger";
import { getQueryStats, normalizeSql, recordQuery, resetQueryStats } from "@/lib/query-metrics";

beforeEach(() => { resetQueryStats(); jest.clearAllMocks(); delete process.env.DB_SLOW_QUERY_MS; });

describe("query-metrics", () => {
  it("strips literals so values are never logged", () => {
    expect(normalizeSql("SELECT * FROM users WHERE phone = '+2348000' AND id = 42")).toBe(
      "SELECT * FROM users WHERE phone = ? AND id = ?"
    );
  });

  it("aggregates count, errors, max and avg", () => {
    recordQuery("SELECT 1", 10);
    recordQuery("SELECT 1", 30, true);
    const [s] = getQueryStats();
    expect(s).toMatchObject({ count: 2, errors: 1, maxMs: 30, avgMs: 20 });
  });

  it("logs slow queries above the configured threshold", () => {
    process.env.DB_SLOW_QUERY_MS = "100";
    recordQuery("SELECT 1", 50);
    expect(logger.warn).not.toHaveBeenCalled();
    recordQuery("SELECT 1", 150);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(getQueryStats()[0].slowCount).toBe(1);
  });

  it("falls back to 500ms for invalid thresholds", () => {
    process.env.DB_SLOW_QUERY_MS = "abc";
    recordQuery("SELECT 1", 499);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("bounds the number of tracked statements", () => {
    for (let i = 0; i < 600; i++) recordQuery(`SELECT * FROM t_${String.fromCharCode(97 + (i % 26))}${"x".repeat(Math.floor(i / 26))}`, 1);
    expect(getQueryStats(1000).length).toBe(500);
  });
});
