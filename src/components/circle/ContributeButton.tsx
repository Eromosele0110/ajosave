"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { track } from "@vercel/analytics";
import { useToast } from "@/components/ui/Toast";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import styles from "./ContributeButton.module.css";

interface Props {
  circleId: string;
  circleName: string;
  amountNgn: number;
  cycleFrequency: string;
  currentCycle: number;
}

/**
 * Contribution states:
 *  idle        – default, no pending action
 *  confirming  – modal is open, waiting for user confirmation
 *  submitting  – API call in-flight (optimistic: button shows "Processing…")
 *  redirecting – API succeeded, redirecting to Paystack
 *  error       – API call failed, rolled back to idle; toast shown
 */
type ContribState = "idle" | "confirming" | "submitting" | "redirecting" | "error";

const REDIRECT_TIMEOUT_MS = 10_000; // 10 s safety-net before rollback

export function ContributeButton({
  circleId,
  circleName,
  amountNgn,
  cycleFrequency,
  currentCycle,
}: Props) {
  const [state, setState] = useState<ContribState>("idle");
  const [feeInfo, setFeeInfo] = useState<{
    authorizationUrl: string;
    platformFee: number;
  } | null>(null);
  const [networkFee, setNetworkFee] = useState<{
    baseFee: number;
    priorityFee: number;
    maxFeeCap: number;
  } | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);

  const { toast } = useToast();
  const { rate, loading: rateLoading } = useExchangeRate("NGN");

  // Guard against setting state on an unmounted component
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Redirect timeout ref — cleared on rollback
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRedirectTimeout = () => {
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current);
      redirectTimeoutRef.current = null;
    }
  };

  // Rollback helper: resets to idle and surfaces the error
  const rollback = useCallback(
    (message: string) => {
      clearRedirectTimeout();
      if (mountedRef.current) {
        setState("error");
        const display = message.includes(
          "contribution amount must equal required amount"
        )
          ? `Contribution must be exactly ₦${amountNgn.toLocaleString("en-NG")} — please do not modify the amount.`
          : message;
        toast(display, "error");
        // Return to idle after showing error so the user can try again
        setTimeout(() => {
          if (mountedRef.current) setState("idle");
        }, 300);
      }
    },
    [amountNgn, toast]
  );

  const usdcEquivalent = rate ? (amountNgn / rate).toFixed(4) : null;
  const feeEstimate = networkFee
    ? `${networkFee.priorityFee} stroops (${(networkFee.priorityFee / 1e7).toFixed(7)} XLM)`
    : "Fetching current Stellar fee…";

  // Fetch Stellar network fee when the modal opens
  useEffect(() => {
    if (state !== "confirming" || networkFee || feeError) return;

    let isMounted = true;
    fetch("/api/stellar/fee")
      .then((res) => res.json())
      .then((json) => {
        if (!isMounted) return;
        if (json.success) {
          setNetworkFee(json.data);
          setFeeError(null);
        } else {
          throw new Error(json.error || "Unable to load network fee");
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setFeeError(
          "Unable to fetch current Stellar fee. Using a conservative estimate."
        );
        console.warn("[ContributeButton] fee fetch failed:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [state, networkFee, feeError]);

  const handleConfirm = async () => {
    // Optimistic: immediately move to submitting state
    setState("submitting");

    try {
      const res = await fetch(`/api/circles/${circleId}/contribute`, {
        method: "POST",
      });
      const json = await res.json();

      if (!json.success) throw new Error(json.error);

      // Track contribution initiation (no PII)
      try {
        track("contribution_made", { circleId, amountNgn });
      } catch {
        /* analytics failure must never block the UX */
      }

      if (!mountedRef.current) return;

      if (json.data.platformFee > 0) {
        // Show fee disclosure before redirecting
        setFeeInfo(json.data);
        setState("confirming");
        return;
      }

      // Move to redirecting state — set a timeout so we roll back if the
      // redirect never fires (e.g. popup blocked, network hiccup)
      setState("redirecting");
      toast("Redirecting to payment…", "info");

      redirectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          rollback(
            "Redirect timed out. Please try again or contact support if the issue persists."
          );
        }
      }, REDIRECT_TIMEOUT_MS);

      window.location.href = json.data.authorizationUrl;
    } catch (err) {
      rollback(err instanceof Error ? err.message : "Failed to initiate payment");
    }
  };

  const handleProceedWithFee = () => {
    if (!feeInfo) return;
    setState("redirecting");
    toast("Redirecting to payment…", "info");

    redirectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        rollback(
          "Redirect timed out. Please try again or contact support if the issue persists."
        );
      }
    }, REDIRECT_TIMEOUT_MS);

    window.location.href = feeInfo.authorizationUrl;
  };

  // Fee disclosure panel (shown after API success when platform fee > 0)
  if (feeInfo && state === "confirming") {
    const feeNgn = (feeInfo.platformFee / 100).toFixed(2);
    return (
      <div
        role="region"
        aria-label="Payment fee disclosure"
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          A platform fee of <strong>₦{feeNgn}</strong> (0.5%) will be added to
          your contribution.
        </p>
        <Button variant="accent" onClick={handleProceedWithFee}>
          Proceed to Payment
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFeeInfo(null);
            setState("idle");
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  const isSubmitting = state === "submitting" || state === "redirecting";

  return (
    <>
      {/* Trigger button — disabled while any async action is in-flight */}
      <Button
        variant="accent"
        onClick={() => setState("confirming")}
        disabled={isSubmitting}
        aria-haspopup="dialog"
      >
        {state === "redirecting" ? "Redirecting…" : "Contribute Now"}
      </Button>

      {/* Confirmation modal */}
      {state === "confirming" && (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          // Allow Escape to cancel
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isSubmitting) setState("idle");
          }}
        >
          <div className={styles.modal}>
            <h2 id="confirm-title" className={styles.title}>
              Confirm Contribution
            </h2>

            <dl className={styles.details}>
              <div className={styles.row}>
                <dt>Circle</dt>
                <dd>{circleName}</dd>
              </div>
              <div className={styles.row}>
                <dt>Amount</dt>
                <dd>₦{amountNgn.toLocaleString("en-NG")}</dd>
              </div>
              <div className={styles.row}>
                <dt>≈ USDC</dt>
                <dd>
                  {rateLoading
                    ? "Loading…"
                    : usdcEquivalent
                    ? `${usdcEquivalent} USDC`
                    : "—"}
                </dd>
              </div>
              <div className={styles.row}>
                <dt>Cycle</dt>
                <dd>
                  Cycle {currentCycle} ({cycleFrequency})
                </dd>
              </div>
              <div className={styles.row}>
                <dt>Network Fee</dt>
                <dd>
                  {networkFee ? (
                    <>
                      {networkFee.priorityFee} stroops (
                      {(networkFee.priorityFee / 1e7).toFixed(7)} XLM)
                      <span
                        style={{
                          display: "block",
                          color: "var(--color-text-muted)",
                          fontSize: "0.8rem",
                        }}
                      >
                        Current base fee {networkFee.baseFee} stroops; capped
                        at {networkFee.maxFeeCap} stroops.
                      </span>
                    </>
                  ) : feeError ? (
                    feeError
                  ) : (
                    feeEstimate
                  )}
                </dd>
              </div>
            </dl>

            <p className={styles.disclaimer}>
              ⚠ Exchange rate is indicative and refreshes every 60 seconds.
              Final USDC amount may vary slightly at settlement.
            </p>

            <div className={styles.actions}>
              <Button
                variant="ghost"
                onClick={() => setState("idle")}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="accent"
                onClick={handleConfirm}
                loading={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? "Processing…" : "Confirm Payment"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline processing overlay when submitting (modal already closed) */}
      {isSubmitting && state !== "confirming" && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Processing your contribution…"
          style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}
        >
          <span className="sr-only">Processing your contribution, please wait…</span>
        </div>
      )}
    </>
  );
}
