"use client";

import { useEffect, useId } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/Button";
import styles from "./error.module.css";

/**
 * Global error boundary component (Next.js App Router).
 *
 * Telemetry strategy:
 *  - Captures the error to Sentry with a rich set of contextual tags and
 *    extra metadata so on-call engineers can triage without needing to
 *    reproduce locally.
 *  - Tags are indexed by Sentry, making it easy to filter issues by page,
 *    component boundary level, and error digest.
 *  - Extra metadata (stack, digest, URL, viewport) is attached as
 *    non-indexed context for deeper investigation.
 *  - Each render of this boundary generates a stable `errorId` that is
 *    shown to the user — they can quote it in a support request and the
 *    ops team can look it up in Sentry.
 *  - Sentry's `withScope` is used to avoid polluting the global scope with
 *    boundary-specific tags that would bleed into other events.
 *
 * Edge cases handled:
 *  - Error object missing a `message` (non-Error rejections)
 *  - Missing `digest` (only set by Next.js for server-side errors)
 *  - Running in a non-browser environment (guards around `window` /
 *    `navigator` access)
 *  - Sentry SDK not initialised (calls are no-ops so the UI still renders)
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Stable ID for this particular boundary render, shown in the UI and
  // attached to the Sentry event for cross-referencing support tickets.
  const errorId = useId();

  useEffect(() => {
    Sentry.withScope((scope) => {
      // ── Structured tags (indexed, filterable in Sentry) ─────────────────
      scope.setTag("boundary", "global");
      scope.setTag("error.type", error.name ?? "UnknownError");

      // Next.js server-side error digest — links client error to the
      // corresponding server-side log entry.
      if (error.digest) {
        scope.setTag("error.digest", error.digest);
      }

      // Runtime context
      if (typeof window !== "undefined") {
        scope.setTag("page.url", window.location.pathname);
        scope.setTag("page.search", window.location.search || "(none)");
      }

      // ── Extra context (non-indexed, shown in event detail) ───────────────
      scope.setExtra("errorId", errorId);
      scope.setExtra("errorMessage", error.message ?? "(no message)");
      scope.setExtra("errorStack", error.stack ?? "(no stack)");

      if (error.digest) {
        scope.setExtra("nextjsDigest", error.digest);
      }

      if (typeof window !== "undefined") {
        scope.setExtra("viewportWidth", window.innerWidth);
        scope.setExtra("viewportHeight", window.innerHeight);
        scope.setExtra("userAgent", navigator.userAgent);
        scope.setExtra("onLine", navigator.onLine);
        scope.setExtra("referrer", document.referrer || "(none)");
      }

      // ── Capture the event ────────────────────────────────────────────────
      Sentry.captureException(error);
    });
  }, [error, errorId]);

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <h2 className={styles.title}>Something went wrong</h2>
        <p className={styles.message}>
          An unexpected error occurred. Please try again.
        </p>
        {/* Show the error ID so users can quote it in support requests */}
        <p className={styles.errorId} aria-label="Error reference ID">
          Error ID: <code>{errorId}</code>
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
