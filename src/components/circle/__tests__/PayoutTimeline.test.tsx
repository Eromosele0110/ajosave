import { render, screen, fireEvent } from "@testing-library/react";
import { PayoutTimeline } from "../PayoutTimeline";
import type { Circle, Member } from "@/types";

// Mock MemberAvatar
jest.mock("@/components/ui/MemberAvatar", () => ({
  MemberAvatar: ({ displayName }: { displayName?: string }) => (
    <span data-testid="member-avatar">{displayName ?? "?"}</span>
  ),
}));

const baseCircle: Circle = {
  id: "circle-1",
  name: "Test Circle",
  creatorId: "user-1",
  contributionUsdc: "10.0000000",
  contributionFiat: 16_000,
  contributionCurrency: "NGN",
  circleType: "public",
  maxMembers: 5,
  cycleFrequency: "monthly",
  payoutMethod: "fixed",
  gracePeriodHours: 24,
  status: "active",
  currentCycle: 2,
  nextPayoutAt: new Date("2026-10-01"),
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

function makeMember(
  id: string,
  position: number,
  overrides: Partial<Member> = {}
): Member {
  return {
    id,
    circleId: "circle-1",
    userId: `user-${id}`,
    displayName: `Member ${id}`,
    position,
    status: "active",
    hasReceivedPayout: false,
    joinedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

const members = [
  makeMember("a", 1, { hasReceivedPayout: true }),  // past
  makeMember("b", 2),                               // current (circle.currentCycle === 2)
  makeMember("c", 3),                               // upcoming
  makeMember("d", 4),                               // upcoming
  makeMember("e", 5),                               // upcoming
  makeMember("f", 6),                               // upcoming
];

describe("PayoutTimeline", () => {
  it("renders the section heading", () => {
    render(<PayoutTimeline members={members} circle={baseCircle} />);
    expect(screen.getByRole("region", { name: /payout timeline/i })).toBeInTheDocument();
  });

  it("renders all visible items including past and current", () => {
    render(
      <PayoutTimeline members={members} circle={baseCircle} previewCount={3} />
    );
    // past + current + 3 upcoming = 5
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(5);
  });

  it("shows 'Paid out' badge for past members", () => {
    render(<PayoutTimeline members={members} circle={baseCircle} />);
    expect(screen.getByText(/paid out ✓/i)).toBeInTheDocument();
  });

  it("shows 'Receiving now' badge for current member", () => {
    render(<PayoutTimeline members={members} circle={baseCircle} />);
    expect(screen.getByText(/receiving now/i)).toBeInTheDocument();
  });

  it("shows 'Show all' toggle when upcoming overflow exists", () => {
    render(
      <PayoutTimeline members={members} circle={baseCircle} previewCount={2} />
    );
    expect(
      screen.getByRole("button", { name: /show all/i })
    ).toBeInTheDocument();
  });

  it("expands all items when Show all is clicked", () => {
    render(
      <PayoutTimeline members={members} circle={baseCircle} previewCount={2} />
    );
    const toggle = screen.getByRole("button", { name: /show all/i });
    fireEvent.click(toggle);
    // past + current + 4 upcoming = 6 total
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(6);
  });

  it("shows 'You' badge for the currentUserId", () => {
    render(
      <PayoutTimeline
        members={members}
        circle={baseCircle}
        currentUserId="user-c"
      />
    );
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("renders skeleton state while loading", () => {
    render(
      <PayoutTimeline
        members={[]}
        circle={baseCircle}
        loading={true}
        previewCount={3}
      />
    );
    expect(
      screen.getByRole("region", { name: /payout timeline loading/i })
    ).toBeInTheDocument();
  });

  it("renders empty state message when no members", () => {
    render(<PayoutTimeline members={[]} circle={baseCircle} />);
    expect(screen.getByText(/no members yet/i)).toBeInTheDocument();
  });
});
