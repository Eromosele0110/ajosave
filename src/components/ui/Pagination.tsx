"use client";

import styles from "./Pagination.module.css";

interface PaginationProps {
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onNext: () => void;
  onPrev: () => void;
  onGoToPage: (_page: number) => void;
  /** Optional label shown alongside controls, e.g. "Showing 1–12 of 48". */
  label?: string;
}

/**
 * Accessible pagination control bar.
 *
 * Renders prev/next buttons and a compact page-number list. The current page
 * button has aria-current="page" for screen-reader compatibility.
 */
export function Pagination({
  page,
  totalPages,
  hasNextPage,
  hasPrevPage,
  onNext,
  onPrev,
  onGoToPage,
  label,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  /**
   * Build a smart page list: always show first, last, current ±1, and
   * ellipsis gaps. Maximum 7 visible slots.
   */
  const buildPageList = (): (number | "…")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | "…")[] = [1];
    const leftBound = Math.max(2, page - 1);
    const rightBound = Math.min(totalPages - 1, page + 1);
    if (leftBound > 2) pages.push("…");
    for (let p = leftBound; p <= rightBound; p++) pages.push(p);
    if (rightBound < totalPages - 1) pages.push("…");
    pages.push(totalPages);
    return pages;
  };

  const pageList = buildPageList();

  return (
    <nav className={styles.nav} aria-label="Pagination">
      {label && <span className={styles.label}>{label}</span>}

      <div className={styles.controls}>
        <button
          className={styles.btn}
          onClick={onPrev}
          disabled={!hasPrevPage}
          aria-label="Previous page"
        >
          ‹
        </button>

        {pageList.map((item, idx) =>
          item === "…" ? (
            <span key={`ellipsis-${idx}`} className={styles.ellipsis} aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              className={`${styles.btn} ${item === page ? styles.active : ""}`}
              onClick={() => onGoToPage(item as number)}
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
            >
              {item}
            </button>
          ),
        )}

        <button
          className={styles.btn}
          onClick={onNext}
          disabled={!hasNextPage}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </nav>
  );
}
