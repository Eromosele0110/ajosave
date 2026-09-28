"use client";

/**
 * usePreventDuplicateSubmit — issue #11
 *
 * Prevents duplicate form submissions caused by:
 *   • Double-clicking the submit button
 *   • Network latency causing the user to resubmit while a request is in-flight
 *   • Browser back/forward navigation replaying a form POST
 *
 * Strategy
 * ────────
 * 1. An idempotency key (UUID v4) is generated per mount and embedded as a
 *    hidden field / request header. The server can use this to deduplicate
 *    concurrent or replayed requests.
 * 2. `isSubmitting` state is tracked; while true the submit button is
 *    disabled and the form's submit handler is a no-op.
 * 3. An in-memory Set of already-submitted keys prevents replay within the
 *    same browser session (clears on page reload as intended).
 * 4. An optional `cooldownMs` (default 800 ms) ignores any second submit
 *    that arrives before the cooldown expires, guarding against double-clicks
 *    even if the async handler resolves instantly.
 *
 * Usage
 * ─────
 * const { isSubmitting, idempotencyKey, handleSubmit } =
 *   usePreventDuplicateSubmit(async (key) => {
 *     await fetch('/api/contribute', {
 *       method: 'POST',
 *       headers: { 'Idempotency-Key': key },
 *       body: JSON.stringify(formData),
 *     });
 *   });
 *
 * return (
 *   <form onSubmit={handleSubmit}>
 *     <input type="hidden" name="idempotency_key" value={idempotencyKey} />
 *     <button type="submit" disabled={isSubmitting}>
 *       {isSubmitting ? 'Submitting…' : 'Submit'}
 *     </button>
 *   </form>
 * );
 */

import { useCallback, useRef, useState } from "react";

/** Simple crypto-grade UUID v4 compatible with all modern browsers. */
function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (e.g. older jsdom)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Module-level set: survives re-renders but clears on page reload.
const submittedKeys = new Set<string>();

export interface UsePreventDuplicateSubmitOptions {
  /** Minimum ms between two accepted submissions. Defaults to 800. */
  cooldownMs?: number;
  /** Called once after a successful submission to allow key rotation. */
  onSuccess?: () => void;
  /** Called when the submission handler throws. */
  onError?: (err: unknown) => void;
}

export interface UsePreventDuplicateSubmitReturn {
  /** True while the submission handler is running. */
  isSubmitting: boolean;
  /** Unique key for the current submission attempt. */
  idempotencyKey: string;
  /**
   * Wrap your form's onSubmit with this handler.
   * It accepts an optional native FormEvent or can be called directly.
   */
  handleSubmit: (e?: { preventDefault?: () => void }) => Promise<void>;
  /** Manually rotate the idempotency key (e.g. after error recovery). */
  rotateKey: () => void;
}

export function usePreventDuplicateSubmit(
  submitFn: (idempotencyKey: string) => Promise<void>,
  options: UsePreventDuplicateSubmitOptions = {}
): UsePreventDuplicateSubmitReturn {
  const { cooldownMs = 800, onSuccess, onError } = options;

  const [idempotencyKey, setIdempotencyKey] = useState<string>(generateIdempotencyKey);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastSubmitAt = useRef<number>(0);

  const rotateKey = useCallback(() => {
    setIdempotencyKey(generateIdempotencyKey());
  }, []);

  const handleSubmit = useCallback(
    async (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();

      // Guard: already in-flight
      if (isSubmitting) return;

      // Guard: cooldown (double-click protection)
      const now = Date.now();
      if (now - lastSubmitAt.current < cooldownMs) return;

      // Guard: duplicate key (replay protection within session)
      if (submittedKeys.has(idempotencyKey)) return;

      lastSubmitAt.current = now;
      submittedKeys.add(idempotencyKey);
      setIsSubmitting(true);

      try {
        await submitFn(idempotencyKey);
        onSuccess?.();
        // Rotate key so the next submission gets a fresh one
        rotateKey();
      } catch (err) {
        // On error: remove the key from the set so the user can retry
        submittedKeys.delete(idempotencyKey);
        onError?.(err);
      } finally {
        setIsSubmitting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSubmitting, idempotencyKey, cooldownMs, submitFn, onSuccess, onError, rotateKey]
  );

  return { isSubmitting, idempotencyKey, handleSubmit, rotateKey };
}
