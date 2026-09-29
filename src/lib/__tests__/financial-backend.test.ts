/**
 * @jest-environment node
 */
jest.mock("../logger", () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));

import { assertValidUsdcAmount, assertValidPartialPayment } from "../money";
import { reconcile } from "../reconciliation";
import {
  applyDeprecationPolicy,
  findDeprecation,
  validateDeprecation,
  DeprecationEntry,
} from "../deprecation";
import { transition, isTerminal, allowedEvents } from "../circle-lifecycle";
import { NextResponse } from "next/server";

describe("money constraints (#27)", () => {
  it("accepts valid amounts", () => {
    expect(assertValidUsdcAmount("10.5")).toBe("10.5");
    expect(assertValidUsdcAmount(1)).toBe("1");
  });
  it.each(["0", "-1", "1.12345678", "abc", "", null, "12345678901234"])("rejects %p", (v) => {
    expect(() => assertValidUsdcAmount(v)).toThrow();
  });
  it("bounds partial payments", () => {
    expect(() => assertValidPartialPayment(5, 10)).not.toThrow();
    expect(() => assertValidPartialPayment(11, 10)).toThrow();
    expect(() => assertValidPartialPayment(-1, 10)).toThrow();
  });
});

describe("reconcile (#30)", () => {
  it("matches clean records exactly despite formatting", () => {
    const r = reconcile(
      [{ id: "c1", reference: "tx1", amountUsdc: "10.0000000", status: "confirmed" }],
      [{ reference: "tx1", amountUsdc: "10", successful: true }],
    );
    expect(r).toEqual({ matched: 1, discrepancies: [] });
  });
  it("classifies every discrepancy kind", () => {
    const r = reconcile(
      [
        { id: "a", reference: null, amountUsdc: "1", status: "confirmed" },
        { id: "b", reference: "tx-missing", amountUsdc: "1", status: "confirmed" },
        { id: "c", reference: "tx-amt", amountUsdc: "1", status: "confirmed" },
        { id: "d", reference: "tx-status", amountUsdc: "1", status: "confirmed" },
        { id: "e", reference: "tx-amt", amountUsdc: "1", status: "confirmed" },
        { id: "f", reference: "tx-pending", amountUsdc: "1", status: "pending" },
      ],
      [
        { reference: "tx-amt", amountUsdc: "1.0000001", successful: true },
        { reference: "tx-status", amountUsdc: "1", successful: false },
        { reference: "tx-orphan", amountUsdc: "1", successful: true },
        { reference: "tx-orphan", amountUsdc: "1", successful: true },
      ],
    );
    expect(r.matched).toBe(0);
    expect(r.discrepancies.map((d) => d.kind).sort()).toEqual(
      [
        "amount_mismatch",
        "duplicate_reference",
        "duplicate_reference",
        "missing_reference",
        "missing_settlement",
        "orphan_settlement",
        "status_mismatch",
      ].sort(),
    );
  });
});

describe("deprecation policy (#33)", () => {
  const entry: DeprecationEntry = {
    path: "/api/v1/old",
    deprecatedAt: "2026-01-01",
    sunsetAt: "2026-06-01",
    successor: "/api/v2/new",
  };
  it("enforces minimum notice", () => {
    expect(() => validateDeprecation(entry)).not.toThrow();
    expect(() => validateDeprecation({ ...entry, sunsetAt: "2026-02-01" })).toThrow();
    expect(() => validateDeprecation({ ...entry, sunsetAt: "bad" })).toThrow();
  });
  it("matches path prefixes and methods", () => {
    expect(findDeprecation("/api/v1/old/1", "GET", [entry])).toBe(entry);
    expect(findDeprecation("/api/v1/older", "GET", [entry])).toBeUndefined();
    expect(findDeprecation("/api/v1/old", "GET", [{ ...entry, method: "POST" }])).toBeUndefined();
  });
  it("adds headers before sunset and 410 after", () => {
    const before = applyDeprecationPolicy("/api/v1/old", "GET", NextResponse.next(), new Date("2026-03-01"), [entry]);
    expect(before.headers.get("Sunset")).toBeTruthy();
    expect(before.headers.get("Link")).toContain("successor-version");
    const after = applyDeprecationPolicy("/api/v1/old", "GET", NextResponse.next(), new Date("2026-07-01"), [entry]);
    expect(after.status).toBe(410);
  });
});

describe("circle lifecycle (#35)", () => {
  const base = { memberCount: 3, maxMembers: 3, currentCycle: 0 };
  it("follows valid transitions", () => {
    expect(transition({ ...base, status: "open" }, "start")).toBe("active");
    expect(transition({ ...base, status: "active" }, "pause")).toBe("paused");
    expect(transition({ ...base, status: "paused" }, "resume")).toBe("active");
    expect(transition({ ...base, status: "paused" }, "cancel")).toBe("cancelled");
    expect(transition({ ...base, status: "active", currentCycle: 3 }, "complete")).toBe("completed");
  });
  it("rejects invalid transitions and guards", () => {
    expect(() => transition({ ...base, status: "completed" }, "cancel")).toThrow();
    expect(() => transition({ ...base, status: "open" }, "pause")).toThrow();
    expect(() => transition({ ...base, status: "bogus" }, "start")).toThrow();
    expect(() => transition({ ...base, status: "open", memberCount: 1 }, "start")).toThrow();
    expect(() => transition({ ...base, status: "active" }, "complete")).toThrow();
  });
  it("knows terminal states", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("active")).toBe(false);
    expect(allowedEvents("cancelled")).toEqual([]);
  });
});
