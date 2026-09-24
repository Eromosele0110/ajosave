import styles from "@/app/circles/[id]/page.module.css";

export function CircleDetailSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading circle details…">
      <span className="sr-only" role="status">Loading circle details…</span>
      <div className="container">
        <div className={styles.header}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div className="skeleton" style={{ width: 240, height: 32, borderRadius: "var(--radius-md)" }} />
            <div className="skeleton" style={{ width: 72, height: 22, borderRadius: "var(--radius-full)" }} />
          </div>
        </div>
        <div className={styles.grid}>
          {/* Details card */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div className="skeleton" style={{ width: 140, height: 18, borderRadius: "var(--radius-sm)" }} />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                <div className="skeleton" style={{ width: "35%", height: 16, borderRadius: "var(--radius-sm)" }} />
                <div className="skeleton" style={{ width: "45%", height: 16, borderRadius: "var(--radius-sm)" }} />
              </div>
            ))}
          </div>
          {/* Members card */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div className="skeleton" style={{ width: 120, height: 18, borderRadius: "var(--radius-sm)" }} />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <div className="skeleton" style={{ width: 32, height: 32, borderRadius: "var(--radius-full)", flexShrink: 0 }} />
                <div className="skeleton" style={{ flex: 1, height: 16, borderRadius: "var(--radius-sm)" }} />
                <div className="skeleton" style={{ width: 64, height: 22, borderRadius: "var(--radius-full)" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
