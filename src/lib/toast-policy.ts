/**
 * Toast notification policy.
 *
 * Centralizes how long toasts stay on screen, how many can be visible, how
 * duplicates are collapsed and how messages are normalized, so every caller of
 * `useToast()` behaves consistently.
 *
 * - Errors stay until dismissed: users must not miss a failed contribution or payout.
 * - At most `MAX_VISIBLE_TOASTS` are shown; the oldest non-error toast is evicted first.
 * - An identical message+variant already on screen is not shown twice.
 * - Messages are trimmed, whitespace-collapsed and length-capped; empty messages are dropped.
 */

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface PolicyToast {
  id: string;
  message: string;
  variant: ToastVariant;
}

/** Auto-dismiss delay in ms per variant; `null` means sticky (manual dismiss only). */
export const TOAST_DURATIONS: Record<ToastVariant, number | null> = {
  success: 4000,
  info: 5000,
  warning: 8000,
  error: null,
};

export const MAX_VISIBLE_TOASTS = 3;
export const MAX_TOAST_LENGTH = 200;

/** Trim, collapse whitespace and cap length. Returns null when nothing is left to show. */
export function normalizeToastMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= MAX_TOAST_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_TOAST_LENGTH - 1)}…`;
}

export function toastDuration(variant: ToastVariant): number | null {
  return variant in TOAST_DURATIONS ? TOAST_DURATIONS[variant] : TOAST_DURATIONS.info;
}

/** Errors interrupt screen readers; everything else is announced politely. */
export function toastRole(variant: ToastVariant): "alert" | "status" {
  return variant === "error" ? "alert" : "status";
}

export interface EnqueueResult {
  toasts: PolicyToast[];
  /** The toast that was added, or null when it was rejected (empty or duplicate). */
  added: PolicyToast | null;
  /** Ids evicted to respect `MAX_VISIBLE_TOASTS`. */
  evicted: string[];
}

/** Apply the policy to add `next` to the currently visible `current` toasts. */
export function enqueueToast(
  current: PolicyToast[],
  next: PolicyToast,
  max: number = MAX_VISIBLE_TOASTS
): EnqueueResult {
  const message = normalizeToastMessage(next.message);
  if (!message) return { toasts: current, added: null, evicted: [] };

  if (current.some((t) => t.message === message && t.variant === next.variant)) {
    return { toasts: current, added: null, evicted: [] };
  }

  const added: PolicyToast = { ...next, message };
  const toasts = [...current, added];
  const evicted: string[] = [];
  const limit = Math.max(1, max);

  while (toasts.length > limit) {
    // Prefer evicting the oldest non-error toast so failures stay visible.
    let idx = toasts.findIndex((t) => t.variant !== "error" && t.id !== added.id);
    if (idx === -1) idx = 0;
    evicted.push(toasts[idx].id);
    toasts.splice(idx, 1);
  }

  return { toasts, added, evicted };
}
