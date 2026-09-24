"use client";

/**
 * useOfflineCache – offline-aware data fetching hook.
 *
 * Provides a cache-then-network strategy in the React layer:
 *
 *  1. On mount, immediately return the last cached response (if any) so the
 *     UI renders instantly even if the device is offline.
 *  2. Attempt a live fetch; on success, update state AND persist the result to
 *     localStorage so future page loads have a warm cache.
 *  3. If the fetch fails and a cached value exists, remain in a degraded-but-
 *     functional state (showing a staleness warning instead of an error screen).
 *  4. Expose `isOffline` so callers can show appropriate UI affordances.
 *
 * Cache entries are versioned and have a configurable TTL (default 5 min) so
 * callers always get reasonably fresh data once connectivity returns.
 *
 * @example
 *   const { data, isLoading, isOffline, isStale } = useOfflineCache<Circle[]>(
 *     "/api/circles",
 *     "circles-list",
 *   );
 */

import { useEffect, useRef, useState } from "react";

const CACHE_PREFIX = "ajosave:cache:v1:";
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  cachedAt: number; // unix ms
}

interface UseOfflineCacheOptions {
  /** How long a cached entry is considered fresh (ms). Default: 5 min. */
  ttlMs?: number;
  /** When false the fetch is skipped entirely (useful for auth-gated data). */
  enabled?: boolean;
}

interface UseOfflineCacheResult<T> {
  data: T | null;
  isLoading: boolean;
  /** True when the network request failed and we are showing cached data. */
  isOffline: boolean;
  /** True when the displayed data is older than ttlMs. */
  isStale: boolean;
  error: string | null;
  /** Force a fresh network fetch and update the cache. */
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage quota or unavailable – silently skip.
  }
}

function isCacheStale(entry: CacheEntry<unknown>, ttlMs: number): boolean {
  return Date.now() - entry.cachedAt > ttlMs;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOfflineCache<T>(
  url: string,
  cacheKey: string,
  options: UseOfflineCacheOptions = {},
): UseOfflineCacheResult<T> {
  const { ttlMs = DEFAULT_TTL_MS, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchTick, setFetchTick] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    // 1. Serve cached data immediately (cache-first paint).
    const cached = readCache<T>(cacheKey);
    if (cached) {
      setData(cached.data);
      setIsStale(isCacheStale(cached, ttlMs));
      setIsLoading(false); // Don't block render – show cached data right away.
    }

    // 2. Always attempt a live network fetch.
    setIsLoading(true);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<T>;
      })
      .then((fresh) => {
        if (cancelled || !mountedRef.current) return;
        writeCache(cacheKey, fresh);
        setData(fresh);
        setIsOffline(false);
        setIsStale(false);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled || !mountedRef.current) return;
        if (cached) {
          // Degraded mode: show stale cached data + offline indicator.
          setIsOffline(true);
          setIsStale(true);
          setError(null); // Not a hard error – data is available from cache.
        } else {
          setError(err.message ?? "Network error");
        }
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [url, cacheKey, ttlMs, enabled, fetchTick]);

  const refresh = () => setFetchTick((t) => t + 1);

  return { data, isLoading, isOffline, isStale, error, refresh };
}
