"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

export default function CirclesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[CirclesError]", error);
  }, [error]);

  return (
    <ErrorState
      title="Failed to load circles"
      message="We couldn't fetch the savings circles. Please check your connection and try again."
      onRetry={reset}
      showHomeLink
    />
  );
}
