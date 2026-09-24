"use client";

import { usePagination } from "@/hooks/usePagination";
import { CircleCard } from "@/components/circle/CircleCard";
import { Pagination } from "@/components/ui/Pagination";
import type { Circle, Member } from "@/types";
import styles from "./PaginatedCircleList.module.css";

const PAGE_SIZE = 12;

interface PaginatedCircleListProps {
  circles: Circle[];
}

/**
 * Renders a paginated grid of CircleCards.
 *
 * Pagination state is managed client-side (no URL changes) using
 * the usePagination hook. The full list is fetched server-side and
 * passed as a prop, so the initial paint is server-rendered.
 */
export function PaginatedCircleList({ circles }: PaginatedCircleListProps) {
  const { items, page, totalPages, totalItems, hasNextPage, hasPrevPage, nextPage, prevPage, goToPage } =
    usePagination(circles, PAGE_SIZE);

  if (circles.length === 0) return null;

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalItems);
  const label = `Showing ${start}–${end} of ${totalItems} circle${totalItems !== 1 ? "s" : ""}`;

  return (
    <div>
      <div className={styles.grid}>
        {items.map((circle) => (
          <CircleCard key={circle.id} circle={circle} members={[] as Member[]} showJoin />
        ))}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        hasNextPage={hasNextPage}
        hasPrevPage={hasPrevPage}
        onNext={nextPage}
        onPrev={prevPage}
        onGoToPage={goToPage}
        label={label}
      />
    </div>
  );
}
