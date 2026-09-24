/**
 * Tests for the shared query invalidation context.
 *
 * We verify:
 *   1. getQueryVersion starts at 0.
 *   2. invalidateQuery bumps the version for the exact key.
 *   3. Invalidating "circles" also bumps "circles:abc" (scoped key) is NOT bumped,
 *      but invalidating "circles:abc" DOES bump "circles" (parent key).
 *   4. Multiple invalidations accumulate (version 1, 2, 3 …).
 *   5. Consumers outside the provider get a stable 0 with no error.
 */

import { renderHook, act } from "@testing-library/react";
import React from "react";
import {
  QueryInvalidationProvider,
  useQueryInvalidation,
} from "../queryInvalidation";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryInvalidationProvider, null, children);

describe("queryInvalidation", () => {
  it("returns version 0 for a key that has never been invalidated", () => {
    const { result } = renderHook(() => useQueryInvalidation(), { wrapper });
    expect(result.current.getQueryVersion("circles")).toBe(0);
  });

  it("increments version for the invalidated key", () => {
    const { result } = renderHook(() => useQueryInvalidation(), { wrapper });

    act(() => {
      result.current.invalidateQuery("circles");
    });

    expect(result.current.getQueryVersion("circles")).toBe(1);
  });

  it("increments parent key when a scoped id is provided", () => {
    const { result } = renderHook(() => useQueryInvalidation(), { wrapper });

    act(() => {
      result.current.invalidateQuery("circles", "abc-123");
    });

    // Parent key is also bumped.
    expect(result.current.getQueryVersion("circles")).toBe(1);
    // Scoped key is bumped.
    expect(result.current.getQueryVersion("circles:abc-123")).toBe(1);
  });

  it("does NOT bump an unrelated scoped key when parent is invalidated", () => {
    const { result } = renderHook(() => useQueryInvalidation(), { wrapper });

    act(() => {
      result.current.invalidateQuery("circles");
    });

    // Scoped key should remain 0.
    expect(result.current.getQueryVersion("circles:abc-123")).toBe(0);
  });

  it("accumulates version across multiple invalidations", () => {
    const { result } = renderHook(() => useQueryInvalidation(), { wrapper });

    act(() => { result.current.invalidateQuery("circles"); });
    act(() => { result.current.invalidateQuery("circles"); });
    act(() => { result.current.invalidateQuery("circles"); });

    expect(result.current.getQueryVersion("circles")).toBe(3);
  });

  it("separate keys are independent", () => {
    const { result } = renderHook(() => useQueryInvalidation(), { wrapper });

    act(() => { result.current.invalidateQuery("contributions"); });

    expect(result.current.getQueryVersion("circles")).toBe(0);
    expect(result.current.getQueryVersion("contributions")).toBe(1);
  });

  it("returns stable 0 when used outside provider (no error)", () => {
    // No wrapper — falls back to the default context value.
    const { result } = renderHook(() => useQueryInvalidation());
    expect(result.current.getQueryVersion("circles")).toBe(0);
    // invalidateQuery is a no-op outside provider.
    expect(() => result.current.invalidateQuery("circles")).not.toThrow();
  });
});
