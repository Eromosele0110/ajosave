import { NextRequest, NextResponse } from "next/server";
import { adminGetPerCircleAnalytics } from "@/server/services/analytics.service";
import { withAdminAuth, withErrorHandler } from "@/server/middleware";
import { createCsvStream, exportResponseHeaders } from "@/lib/streaming-export";

const COLUMNS = [
  { key: "circleId", header: "Circle ID" },
  { key: "circleName", header: "Circle Name" },
  { key: "creatorId", header: "Creator ID" },
  { key: "status", header: "Status" },
  { key: "totalContributionsCount", header: "Total Contributions Count" },
  { key: "confirmedContributionsCount", header: "Confirmed Contributions Count" },
  { key: "missedContributionsCount", header: "Missed Contributions Count" },
  { key: "totalSaved", header: "Total Saved (USDC)" },
  { key: "completionRate", header: "Completion Rate (%)" },
  { key: "defaultRate", header: "Default Rate (%)" },
  { key: "activeMembersCount", header: "Active Members Count" },
  { key: "defaultedMembersCount", header: "Defaulted Members Count" },
] as const;

export const GET = withErrorHandler(
  withAdminAuth(async (_req: NextRequest) => {
    const data = await adminGetPerCircleAnalytics();

    const records = data.map((row) => ({
      circleId: row.circleId,
      circleName: row.circleName,
      creatorId: row.creatorId,
      status: row.status,
      totalContributionsCount: row.totalContributionsCount,
      confirmedContributionsCount: row.confirmedContributionsCount,
      missedContributionsCount: row.missedContributionsCount,
      totalSaved: row.totalSaved,
      completionRate: row.completionRate,
      defaultRate: row.defaultRate,
      activeMembersCount: row.activeMembersCount,
      defaultedMembersCount: row.defaultedMembersCount,
    }));

    const filename = `circle_performance_analytics_${new Date().toISOString().split("T")[0]}`;
    return new NextResponse(createCsvStream(records, { columns: [...COLUMNS] }), {
      status: 200,
      headers: exportResponseHeaders(filename),
    });
  })
);
