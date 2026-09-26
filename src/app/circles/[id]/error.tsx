"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

export default function CircleDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[CircleDetailError]", error);
  }, [error]);

  return (
    <ErrorState
      title="Failed to load circle"
      message="We couldn't load this savings circle. It may have been removed or you may not have access."
      onRetry={reset}
      showHomeLink
    />
  );
}
