"use client";

import { useState, useMemo, useCallback } from "react";

export interface PaginationState {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface UsePaginationResult<T> extends PaginationState {
  items: T[];
  goToPage: (_page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setPageSize: (_size: number) => void;
}

/**
 * Generic client-side pagination hook.
 *
 * Slices an in-memory array into pages. For server-side pagination use the
 * pagination params on the API layer; this hook handles the UI state only.
 *
 * @param allItems - Full array of items to paginate.
 * @param initialPageSize - Number of items per page (default 12).
 */
export function usePagination<T>(
  allItems: T[],
  initialPageSize = 12,
): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Clamp current page when total changes (e.g. after filtering).
  const clampedPage = Math.min(page, totalPages);

  const items = useMemo(() => {
    const start = (clampedPage - 1) * pageSize;
    return allItems.slice(start, start + pageSize);
  }, [allItems, clampedPage, pageSize]);

  const goToPage = useCallback(
    (target: number) => {
      setPage(Math.max(1, Math.min(target, totalPages)));
    },
    [totalPages],
  );

  const nextPage = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setPage((p) => Math.max(p - 1, 1));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1); // Reset to first page when page size changes.
  }, []);

  return {
    items,
    page: clampedPage,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: clampedPage < totalPages,
    hasPrevPage: clampedPage > 1,
    goToPage,
    nextPage,
    prevPage,
    setPageSize,
  };
}
