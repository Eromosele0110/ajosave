/**
 * Tests for the useOfflineCache hook.
 *
 * We verify the four key behaviors:
 *   1. Returns cached data immediately on mount (no network flash).
 *   2. Fetches fresh data and updates the cache on success.
 *   3. Falls back to stale cache and sets isOffline=true on network failure.
 *   4. Sets a hard error only when there is no cached fallback.
 *   5. refresh() triggers a new fetch cycle.
 *   6. disabled (enabled=false) skips fetching entirely.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useOfflineCache } from "../useOfflineCache";

// ── localStorage shim ────────────────────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock: Storage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(window, "localStorage", { value: localStorageMock, writable: true });

// ── fetch mock ───────────────────────────────────────────────────────────────
const fetchMock = jest.fn();
global.fetch = fetchMock;

const OK_RESPONSE = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response);

const FAIL_RESPONSE = () => Promise.reject(new Error("Network error"));

const CACHE_KEY = "test-circles";
const CACHE_PREFIX = "ajosave:cache:v1:";

describe("useOfflineCache", () => {
  beforeEach(() => {
    localStorageMock.clear();
    fetchMock.mockClear();
  });

  it("returns null while loading when there is no cache", async () => {
    fetchMock.mockReturnValueOnce(OK_RESPONSE([]));

    const { result } = renderHook(() =>
      useOfflineCache<unknown[]>("/api/circles", CACHE_KEY),
    );

    // isLoading is true on first render.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });

  it("serves cached data immediately before network resolves", async () => {
    const cached = [{ id: "1", name: "Cached Circle" }];
    localStorageMock.setItem(
      CACHE_PREFIX + CACHE_KEY,
      JSON.stringify({ data: cached, cachedAt: Date.now() }),
    );

    // Network resolves with fresh data after a delay.
    const fresh = [{ id: "2", name: "Fresh Circle" }];
    fetchMock.mockReturnValueOnce(OK_RESPONSE(fresh));

    const { result } = renderHook(() =>
      useOfflineCache<unknown[]>("/api/circles", CACHE_KEY),
    );

    // Cached data should be available before the network promise settles.
    expect(result.current.data).toEqual(cached);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // After network resolves, fresh data replaces cached.
    expect(result.current.data).toEqual(fresh);
    expect(result.current.isOffline).toBe(false);
  });

  it("sets isOffline=true and shows stale cache when network fails", async () => {
    const cached = [{ id: "1" }];
    localStorageMock.setItem(
      CACHE_PREFIX + CACHE_KEY,
      JSON.stringify({ data: cached, cachedAt: Date.now() - 10_000 }),
    );
    fetchMock.mockReturnValueOnce(FAIL_RESPONSE());

    const { result } = renderHook(() =>
      useOfflineCache<unknown[]>("/api/circles", CACHE_KEY),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(cached);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.isStale).toBe(true);
    expect(result.current.error).toBeNull(); // Not a hard error – cache available.
  });

  it("sets error when network fails and there is no cache", async () => {
    fetchMock.mockReturnValueOnce(FAIL_RESPONSE());

    const { result } = renderHook(() =>
      useOfflineCache<unknown[]>("/api/circles", CACHE_KEY),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Network error");
  });

  it("refresh() triggers a new fetch", async () => {
    fetchMock
      .mockReturnValueOnce(OK_RESPONSE([{ id: "1" }]))
      .mockReturnValueOnce(OK_RESPONSE([{ id: "1" }, { id: "2" }]));

    const { result } = renderHook(() =>
      useOfflineCache<unknown[]>("/api/circles", CACHE_KEY),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);

    act(() => { result.current.refresh(); });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips fetching when enabled=false", () => {
    const { result } = renderHook(() =>
      useOfflineCache<unknown[]>("/api/circles", CACHE_KEY, { enabled: false }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
