import {
  enqueueToast,
  normalizeToastMessage,
  toastDuration,
  toastRole,
  MAX_TOAST_LENGTH,
  MAX_VISIBLE_TOASTS,
  type PolicyToast,
} from "../toast-policy";

const t = (id: string, message: string, variant: PolicyToast["variant"] = "info"): PolicyToast => ({
  id,
  message,
  variant,
});

describe("toast policy", () => {
  it("keeps errors on screen until dismissed and auto-dismisses others", () => {
    expect(toastDuration("error")).toBeNull();
    expect(toastDuration("success")).toBeGreaterThan(0);
    expect(toastDuration("info")).toBeGreaterThan(0);
    expect(toastDuration("warning")!).toBeGreaterThan(toastDuration("info")!);
  });

  it("uses role=alert only for errors", () => {
    expect(toastRole("error")).toBe("alert");
    expect(toastRole("success")).toBe("status");
    expect(toastRole("warning")).toBe("status");
  });

  it("normalizes whitespace and rejects empty or non-string messages", () => {
    expect(normalizeToastMessage("  Payment\n\n  sent  ")).toBe("Payment sent");
    expect(normalizeToastMessage("   ")).toBeNull();
    expect(normalizeToastMessage(undefined)).toBeNull();
    expect(normalizeToastMessage(42)).toBeNull();
  });

  it("caps message length at the boundary", () => {
    expect(normalizeToastMessage("a".repeat(MAX_TOAST_LENGTH))).toHaveLength(MAX_TOAST_LENGTH);
    const long = normalizeToastMessage("a".repeat(MAX_TOAST_LENGTH + 1))!;
    expect(long).toHaveLength(MAX_TOAST_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });

  it("drops duplicates of a visible toast with the same variant", () => {
    const current = [t("1", "Contribution failed", "error")];
    expect(enqueueToast(current, t("2", " Contribution  failed ", "error")).added).toBeNull();
    expect(enqueueToast(current, t("3", "Contribution failed", "warning")).added).not.toBeNull();
  });

  it("rejects empty messages without changing state", () => {
    const current = [t("1", "hi")];
    const res = enqueueToast(current, t("2", "  "));
    expect(res.added).toBeNull();
    expect(res.toasts).toBe(current);
  });

  it("evicts the oldest non-error toast past the visible limit", () => {
    let toasts: PolicyToast[] = [t("e", "Payout failed", "error")];
    for (let i = 0; i < MAX_VISIBLE_TOASTS; i++) {
      toasts = enqueueToast(toasts, t(`i${i}`, `info ${i}`)).toasts;
    }
    const ids = toasts.map((x) => x.id);
    expect(toasts).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(ids).toContain("e");
    expect(ids).not.toContain("i0");
  });

  it("evicts the oldest error when every visible toast is an error", () => {
    let toasts: PolicyToast[] = [];
    const evicted: string[] = [];
    for (let i = 0; i <= MAX_VISIBLE_TOASTS; i++) {
      const res = enqueueToast(toasts, t(`e${i}`, `error ${i}`, "error"));
      toasts = res.toasts;
      evicted.push(...res.evicted);
    }
    expect(evicted).toEqual(["e0"]);
    expect(toasts).toHaveLength(MAX_VISIBLE_TOASTS);
  });
});
