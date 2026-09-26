"use client";

import { useEffect, useState, useCallback } from "react";
import { useQueryInvalidation } from "@/lib/queryInvalidation";
import type { Circle } from "@/types";

export const QUERY_KEYS = {
  circles: "circles",
  circle: (id: string) => `circles:${id}`,
  contributions: "contributions",
  contribution: (id: string) => `contributions:${id}`,
  dashboard: "dashboard",
} as const;

interface UseCirclesQueryResult {
  circles: Circle[];
  isLoading: boolean;
  error: string | null;
  /** Manually trigger a refresh without needing an invalidation event. */
  refresh: () => void;
}

/**
 * Fetches the open circles list and automatically refetches whenever
 * the "circles" query key is invalidated via useQueryInvalidation.
 *
 * Any component can trigger a shared refetch across all consumers by calling:
 *   const { invalidateQuery } = useQueryInvalidation();
 *   invalidateQuery("circles");
 */
export function useCirclesQuery(): UseCirclesQueryResult {
  const { getQueryVersion, invalidateQuery: _invalidateQuery } = useQueryInvalidation();

  // Track the invalidation version as a refetch trigger.
  const version = getQueryVersion(QUERY_KEYS.circles);

  const [circles, setCircles] = useState<Circle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch("/api/circles")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const data: Circle[] = json?.data ?? json ?? [];
        setCircles(Array.isArray(data) ? data : []);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message ?? "Failed to load circles");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `version` changes whenever invalidateQuery("circles") is called,
    // causing this effect to re-run and refetch.
  }, [version]);

  const refresh = useCallback(() => {
    _invalidateQuery(QUERY_KEYS.circles);
  }, [_invalidateQuery]);

  return { circles, isLoading, error, refresh };
}
