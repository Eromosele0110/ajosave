import { CircleCardSkeleton } from "@/components/circle/CircleCardSkeleton";
import styles from "./LiveDashboard.module.css";

export function DashboardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading your circles…">
      <span className="sr-only" role="status">Loading your circles…</span>
      <div className={styles.header}>
        <div className="skeleton" style={{ width: 140, height: 28, borderRadius: "var(--radius-sm)" }} />
        <div className="skeleton" style={{ width: 120, height: 36, borderRadius: "var(--radius-md)" }} />
      </div>
      <div className={styles.grid}>
        {Array.from({ length: count }).map((_, i) => (
          <CircleCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
