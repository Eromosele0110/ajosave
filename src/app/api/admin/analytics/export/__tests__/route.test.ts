/**
 * @jest-environment node
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("@/server/middleware", () => ({
  withErrorHandler: (handler: Function) => handler,
  withAdminAuth: (handler: Function) => handler,
}));
jest.mock("@/server/services/analytics.service", () => ({ adminGetPerCircleAnalytics: jest.fn() }));

import { adminGetPerCircleAnalytics } from "@/server/services/analytics.service";
import { GET } from "../route";

const mockAnalytics = adminGetPerCircleAnalytics as jest.Mock;

const row = (overrides: Record<string, unknown> = {}) => ({
  circleId: "c1",
  circleName: "Family Ajo",
  creatorId: "u1",
  status: "active",
  totalContributionsCount: 10,
  confirmedContributionsCount: 8,
  missedContributionsCount: 2,
  totalSaved: "200.00",
  completionRate: 80,
  defaultRate: 20,
  activeMembersCount: 5,
  defaultedMembersCount: 1,
  ...overrides,
});

describe("GET /api/admin/analytics/export", () => {
  it("streams the analytics as an uncacheable CSV attachment", async () => {
    mockAnalytics.mockResolvedValue([row()]);
    const res = await GET({} as any);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="circle_performance_analytics_\d{4}-\d{2}-\d{2}\.csv"$/
    );

    const [header, first] = (await res.text()).split("\r\n");
    expect(header).toBe(
      "Circle ID,Circle Name,Creator ID,Status,Total Contributions Count,Confirmed Contributions Count," +
        "Missed Contributions Count,Total Saved (USDC),Completion Rate (%),Default Rate (%)," +
        "Active Members Count,Defaulted Members Count"
    );
    expect(first).toBe("c1,Family Ajo,u1,active,10,8,2,200.00,80,20,5,1");
  });

  it("neutralises spreadsheet formulas in circle names", async () => {
    mockAnalytics.mockResolvedValue([row({ circleName: "=1+1" })]);
    const text = await (await GET({} as any)).text();
    expect(text).toContain("c1,'=1+1,u1");
  });

  it("returns only the header row when there is no data", async () => {
    mockAnalytics.mockResolvedValue([]);
    const text = await (await GET({} as any)).text();
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(1);
  });
});
