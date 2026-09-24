import { renderHook, act } from "@testing-library/react";
import { usePagination } from "../usePagination";

const makeItems = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe("usePagination", () => {
  it("returns first page of items by default", () => {
    const items = makeItems(30);
    const { result } = renderHook(() => usePagination(items, 10));

    expect(result.current.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.hasPrevPage).toBe(false);
    expect(result.current.hasNextPage).toBe(true);
  });

  it("advances to next page", () => {
    const items = makeItems(30);
    const { result } = renderHook(() => usePagination(items, 10));

    act(() => result.current.nextPage());

    expect(result.current.page).toBe(2);
    expect(result.current.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(result.current.hasPrevPage).toBe(true);
  });

  it("does not go below page 1", () => {
    const items = makeItems(5);
    const { result } = renderHook(() => usePagination(items, 10));

    act(() => result.current.prevPage());

    expect(result.current.page).toBe(1);
  });

  it("does not go above total pages", () => {
    const items = makeItems(5);
    const { result } = renderHook(() => usePagination(items, 10));

    act(() => result.current.nextPage());

    expect(result.current.page).toBe(1); // only one page
    expect(result.current.hasNextPage).toBe(false);
  });

  it("goToPage jumps to a specific page", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, 10));

    act(() => result.current.goToPage(4));

    expect(result.current.page).toBe(4);
    expect(result.current.items[0]).toBe(31);
  });

  it("handles an empty list", () => {
    const { result } = renderHook(() => usePagination([], 10));

    expect(result.current.items).toEqual([]);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.hasPrevPage).toBe(false);
  });

  it("setPageSize resets to page 1 and re-slices", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, 10));

    act(() => result.current.goToPage(3));
    expect(result.current.page).toBe(3);

    act(() => result.current.setPageSize(25));

    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.items).toHaveLength(25);
  });

  it("clamps page when list shrinks", () => {
    let data = makeItems(50);
    const { result, rerender } = renderHook(({ d }) => usePagination(d, 10), {
      initialProps: { d: data },
    });

    act(() => result.current.goToPage(5));
    expect(result.current.page).toBe(5);

    // Shrink the list so page 5 no longer exists.
    data = makeItems(20);
    rerender({ d: data });

    expect(result.current.page).toBe(2); // clamped to totalPages
  });
});
