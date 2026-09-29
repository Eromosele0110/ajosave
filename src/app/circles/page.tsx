import type { Metadata } from "next";
import { Suspense } from "react";
import { listCircles } from "@/server/services/circle.service";
import { PaginatedCircleList } from "@/components/circle/PaginatedCircleList";
import { CircleFiltersForm } from "@/components/circle/CircleFiltersForm";
import type { CircleFilters } from "@/types";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Browse Circles" };

interface CirclesPageProps {
  searchParams: {
    status?: string;
    frequency?: string;
    minAmount?: string;
    maxAmount?: string;
    maxMembers?: string;
    search?: string;
    page?: string;
    cursor?: string;
    filter?: string;
  };
}

/**
 * Circles listing page with filter support.
 *
 * Filters are read from URL search params so that filtered URLs are
 * shareable and server-rendered on every navigation. The filter form
 * (client component) updates the URL; this page re-renders on the
 * server with the new params.
 */
export default async function CirclesPage({ searchParams }: CirclesPageProps) {
  // Parse filter params from URL (all optional)
  const filters: CircleFilters = {
    status: (searchParams.status as CircleFilters["status"]) || undefined,
    frequency: (searchParams.frequency as CircleFilters["frequency"]) || undefined,
    minAmount: searchParams.minAmount ? parseInt(searchParams.minAmount, 10) : undefined,
    maxAmount: searchParams.maxAmount ? parseInt(searchParams.maxAmount, 10) : undefined,
    maxMembers: searchParams.maxMembers ? parseInt(searchParams.maxMembers, 10) : undefined,
    search: searchParams.search || undefined,
  };

  const circles = await listCircles(filters);

  const hasActiveFilters =
    !!filters.status ||
    !!filters.frequency ||
    !!filters.search ||
    filters.minAmount !== undefined ||
    filters.maxAmount !== undefined ||
    filters.maxMembers !== undefined;

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Open Circles</h1>
          <Link href="/circles/create" className="btn btn--accent">
            + New Circle
          </Link>
        </div>

        {/* Filter controls — wrapped in Suspense because it uses useSearchParams */}
        <Suspense fallback={null}>
          <CircleFiltersForm filters={filters} />
        </Suspense>

        {circles.length === 0 ? (
          <div className={styles.empty}>
            {hasActiveFilters ? (
              <>
                <p>No circles match your filters.</p>
                <Link href="/circles" className="btn btn--primary">
                  Clear filters
                </Link>
              </>
            ) : (
              <>
                <p>No open circles yet.</p>
                <Link href="/circles/create" className="btn btn--primary">
                  Be the first to create one
                </Link>
              </>
            )}
          </div>
        ) : (
          <PaginatedCircleList circles={circles} />
        )}
      </div>
    </div>
  );
}
