"use client";

/**
 * Shared query invalidation.
 *
 * A lightweight React context that lets any component invalidate named data
 * queries and causes all hooks that depend on those queries to refetch.
 *
 * This mirrors the invalidateQueries pattern from TanStack Query without
 * adding a new library dependency.
 *
 * ─── Setup ───────────────────────────────────────────────────────────────────
 *
 *   // In layout.tsx or a Providers component:
 *   import { QueryInvalidationProvider } from "@/lib/queryInvalidation";
 *   <QueryInvalidationProvider>{children}</QueryInvalidationProvider>
 *
 * ─── Triggering invalidation (e.g. after a mutation) ─────────────────────────
 *
 *   const { invalidateQuery } = useQueryInvalidation();
 *   // Invalidate all "circles" subscribers:
 *   invalidateQuery("circles");
 *   // Invalidate a specific circle + the parent "circles" key:
 *   invalidateQuery("circles", "abc-123");
 *
 * ─── Consuming inside a data-fetching hook ────────────────────────────────────
 *
 *   const { getQueryVersion } = useQueryInvalidation();
 *   const version = getQueryVersion("circles");
 *   useEffect(() => {
 *     fetchCircles().then(setData);
 *   }, [version]);
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryKey = string;

interface VersionMap {
  [key: QueryKey]: number;
}

interface QueryInvalidationContextValue {
  /** Current version snapshot – used by getQueryVersion. */
  _versions: VersionMap;
  /**
   * Invalidates a query key (and optionally a specific record id).
   * All components that read the matching version will re-render and can
   * use the new value as a useEffect dependency to trigger a refetch.
   */
  invalidateQuery: (key: QueryKey, id?: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const QueryInvalidationContext = createContext<QueryInvalidationContextValue>({
  _versions: {},
  invalidateQuery: () => {},
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type InvalidateAction = { key: QueryKey; id?: string };

function versionsReducer(state: VersionMap, action: InvalidateAction): VersionMap {
  const next = { ...state };
  if (action.id) {
    const scoped = `${action.key}:${action.id}`;
    next[scoped] = (next[scoped] ?? 0) + 1;
  }
  // Always bump the parent key so listeners on the broad key also update.
  next[action.key] = (next[action.key] ?? 0) + 1;
  return next;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function QueryInvalidationProvider({ children }: { children: React.ReactNode }) {
  const [versions, dispatch] = useReducer(versionsReducer, {});

  const invalidateQuery = useCallback((key: QueryKey, id?: string) => {
    dispatch({ key, id });
  }, []);

  const value = useMemo(
    () => ({ _versions: versions, invalidateQuery }),
    [versions, invalidateQuery],
  );

  return (
    <QueryInvalidationContext.Provider value={value}>
      {children}
    </QueryInvalidationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export interface UseQueryInvalidationResult {
  /**
   * Returns the current integer version for a query key.
   * The value increments each time that key is invalidated.
   * Pass it as a dependency to a useEffect to trigger a refetch.
   *
   * @example
   *   const version = getQueryVersion("circles");
   *   useEffect(() => { fetchCircles() }, [version]);
   */
  getQueryVersion: (key: QueryKey) => number;
  /**
   * Invalidates a named query, causing all consumers of that key to refetch.
   *
   * @param key - The query name (e.g. "circles", "contributions").
   * @param id  - Optional record id for scoped invalidation.
   *              Also bumps the parent key, so broad listeners update too.
   */
  invalidateQuery: (key: QueryKey, id?: string) => void;
}

export function useQueryInvalidation(): UseQueryInvalidationResult {
  const { _versions, invalidateQuery } = useContext(QueryInvalidationContext);

  const getQueryVersion = useCallback(
    (key: QueryKey): number => _versions[key] ?? 0,
    [_versions],
  );

  return { getQueryVersion, invalidateQuery };
}
