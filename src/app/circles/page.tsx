import type { Metadata } from "next";
import { listOpenCircles } from "@/server/services/circle.service";
import { PaginatedCircleList } from "@/components/circle/PaginatedCircleList";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Browse Circles" };

export default async function CirclesPage() {
  const circles = await listOpenCircles();

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Open Circles</h1>
          <Link href="/circles/create" className="btn btn--accent">
            + New Circle
          </Link>
        </div>

        {circles.length === 0 ? (
          <div className={styles.empty}>
            <p>No open circles yet.</p>
            <Link href="/circles/create" className="btn btn--primary">
              Be the first to create one
            </Link>
          </div>
        ) : (
          <PaginatedCircleList circles={circles} />
        )}
      </div>
    </div>
  );
}
