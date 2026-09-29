"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { CircleFilters } from "@/types";
import styles from "./CircleFiltersForm.module.css";

interface CircleFiltersFormProps {
  /** Current filter values (read from URL search params by the parent). */
  filters: CircleFilters;
}

/**
 * Client-side filter controls for the circles listing page.
 *
 * Persists filter state in the URL query string so that links are shareable
 * and the browser back-button restores the previous filter state.
 */
export function CircleFiltersForm({ filters }: CircleFiltersFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  /** Build a new URLSearchParams from the current ones, applying a patch. */
  const updateParams = useCallback(
    (patch: Partial<Record<string, string>>) => {
      const params = new URLSearchParams(searchParams.toString());
      // Reset to page 1 whenever a filter changes
      params.delete("page");
      params.delete("cursor");

      for (const [key, value] of Object.entries(patch)) {
        if (value === "" || value === undefined) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams]
  );

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateParams({ search: e.target.value });
    },
    [updateParams]
  );

  const handleStatus = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateParams({ status: e.target.value });
    },
    [updateParams]
  );

  const handleFrequency = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateParams({ frequency: e.target.value });
    },
    [updateParams]
  );

  const handleMinAmount = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateParams({ minAmount: e.target.value });
    },
    [updateParams]
  );

  const handleMaxAmount = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateParams({ maxAmount: e.target.value });
    },
    [updateParams]
  );

  const handleMaxMembers = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateParams({ maxMembers: e.target.value });
    },
    [updateParams]
  );

  const handleReset = useCallback(() => {
    startTransition(() => {
      router.push(pathname);
    });
  }, [router, pathname]);

  const hasActiveFilters =
    !!filters.search ||
    !!filters.status ||
    !!filters.frequency ||
    filters.minAmount !== undefined ||
    filters.maxAmount !== undefined ||
    filters.maxMembers !== undefined;

  return (
    <aside className={styles.filters} aria-label="Filter circles">
      <div className={styles.filterRow}>
        {/* Search */}
        <div className={styles.field}>
          <label htmlFor="circle-search" className={styles.label}>
            Search
          </label>
          <input
            id="circle-search"
            type="search"
            className={styles.input}
            placeholder="Circle name…"
            defaultValue={filters.search ?? ""}
            onChange={handleSearch}
            aria-label="Search circles by name"
          />
        </div>

        {/* Status */}
        <div className={styles.field}>
          <label htmlFor="circle-status" className={styles.label}>
            Status
          </label>
          <select
            id="circle-status"
            className={styles.select}
            defaultValue={filters.status ?? ""}
            onChange={handleStatus}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        {/* Frequency */}
        <div className={styles.field}>
          <label htmlFor="circle-frequency" className={styles.label}>
            Frequency
          </label>
          <select
            id="circle-frequency"
            className={styles.select}
            defaultValue={filters.frequency ?? ""}
            onChange={handleFrequency}
            aria-label="Filter by contribution frequency"
          >
            <option value="">Any frequency</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {/* Max members */}
        <div className={styles.field}>
          <label htmlFor="circle-max-members" className={styles.label}>
            Group size
          </label>
          <select
            id="circle-max-members"
            className={styles.select}
            defaultValue={filters.maxMembers?.toString() ?? ""}
            onChange={handleMaxMembers}
            aria-label="Filter by group size"
          >
            <option value="">Any size</option>
            {[2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => (
              <option key={n} value={n.toString()}>
                {n} members
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.filterRow}>
        {/* Min contribution amount */}
        <div className={styles.field}>
          <label htmlFor="circle-min-amount" className={styles.label}>
            Min amount (NGN)
          </label>
          <input
            id="circle-min-amount"
            type="number"
            min={0}
            step={1000}
            className={styles.input}
            placeholder="e.g. 5000"
            defaultValue={filters.minAmount ?? ""}
            onChange={handleMinAmount}
            aria-label="Minimum contribution amount in NGN"
          />
        </div>

        {/* Max contribution amount */}
        <div className={styles.field}>
          <label htmlFor="circle-max-amount" className={styles.label}>
            Max amount (NGN)
          </label>
          <input
            id="circle-max-amount"
            type="number"
            min={0}
            step={1000}
            className={styles.input}
            placeholder="e.g. 50000"
            defaultValue={filters.maxAmount ?? ""}
            onChange={handleMaxAmount}
            aria-label="Maximum contribution amount in NGN"
          />
        </div>

        {/* Reset */}
        {hasActiveFilters && (
          <div className={styles.fieldReset}>
            <button
              type="button"
              className={styles.resetBtn}
              onClick={handleReset}
              aria-label="Clear all filters"
            >
              Clear filters
            </button>
          </div>
        )}

        {isPending && (
          <div className={styles.loadingIndicator} aria-live="polite" aria-label="Updating results">
            <span className={styles.spinner} aria-hidden="true" />
            <span className={styles.loadingText}>Updating…</span>
          </div>
        )}
      </div>
    </aside>
  );
}
