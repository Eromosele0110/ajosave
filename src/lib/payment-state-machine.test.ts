import {
  CONTRIBUTION_STATUSES,
  PAYOUT_STATUSES,
  canTransitionContribution,
  assertContributionTransition,
  isTerminalContributionState,
  canTransitionPayout,
  assertPayoutTransition,
  isTerminalPayoutState,
  InvalidStateTransitionError,
  type ContributionState,
  type PayoutState,
} from "./payment-state-machine";

describe("contribution state machine", () => {
  it.each([
    ["pending", "confirmed"],
    ["pending", "failed"],
    ["pending", "missed"],
    ["confirmed", "refund_pending"],
    ["refund_pending", "refunded"],
  ] as [ContributionState, ContributionState][])("allows %s -> %s", (from, to) => {
    expect(canTransitionContribution(from, to)).toBe(true);
    expect(() => assertContributionTransition(from, to)).not.toThrow();
  });

  it.each([
    ["confirmed", "pending"],
    ["missed", "confirmed"],
    ["failed", "confirmed"],
    ["refunded", "refund_pending"],
    ["refund_pending", "pending"],
    ["pending", "refunded"],
  ] as [ContributionState, ContributionState][])("rejects %s -> %s", (from, to) => {
    expect(canTransitionContribution(from, to)).toBe(false);
    expect(() => assertContributionTransition(from, to)).toThrow(InvalidStateTransitionError);
  });

  it("rejects a no-op transition (same state to itself)", () => {
    for (const state of CONTRIBUTION_STATUSES) {
      expect(canTransitionContribution(state, state)).toBe(false);
    }
  });

  it("treats failed, missed, and refunded as terminal", () => {
    expect(isTerminalContributionState("failed")).toBe(true);
    expect(isTerminalContributionState("missed")).toBe(true);
    expect(isTerminalContributionState("refunded")).toBe(true);
    expect(isTerminalContributionState("pending")).toBe(false);
    expect(isTerminalContributionState("confirmed")).toBe(false);
    expect(isTerminalContributionState("refund_pending")).toBe(false);
  });

  it("assertContributionTransition throws an error naming the entity, from, and to", () => {
    try {
      assertContributionTransition("refunded", "pending");
      throw new Error("expected assertContributionTransition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidStateTransitionError);
      const e = err as InvalidStateTransitionError;
      expect(e.entity).toBe("contribution");
      expect(e.from).toBe("refunded");
      expect(e.to).toBe("pending");
    }
  });
});

describe("payout state machine", () => {
  it.each([
    ["pending", "completed"],
    ["pending", "failed"],
    ["failed", "pending"],
  ] as [PayoutState, PayoutState][])("allows %s -> %s", (from, to) => {
    expect(canTransitionPayout(from, to)).toBe(true);
    expect(() => assertPayoutTransition(from, to)).not.toThrow();
  });

  it.each([
    ["completed", "pending"],
    ["completed", "failed"],
    ["failed", "completed"],
  ] as [PayoutState, PayoutState][])("rejects %s -> %s", (from, to) => {
    expect(canTransitionPayout(from, to)).toBe(false);
    expect(() => assertPayoutTransition(from, to)).toThrow(InvalidStateTransitionError);
  });

  it("rejects a no-op transition (same state to itself)", () => {
    for (const state of PAYOUT_STATUSES) {
      expect(canTransitionPayout(state, state)).toBe(false);
    }
  });

  it("treats completed as terminal, and failed/pending as non-terminal", () => {
    expect(isTerminalPayoutState("completed")).toBe(true);
    expect(isTerminalPayoutState("pending")).toBe(false);
    expect(isTerminalPayoutState("failed")).toBe(false);
  });
});
