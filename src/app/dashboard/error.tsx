"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console in dev; Sentry/observability picks this up in production
    console.error("[DashboardError]", error);
  }, [error]);

  return (
    <ErrorState
      title="Failed to load dashboard"
      message="We couldn't load your circles. Please check your connection and try again."
      onRetry={reset}
      showHomeLink
    />
  );
}
