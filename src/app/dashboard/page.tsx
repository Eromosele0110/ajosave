import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCirclesByUser } from "@/server/services/circle.service";
import { CircleCard } from "@/components/circle/CircleCard";
import { EmptyState } from "@/components/ui/EmptyState";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = (session.user as { id: string }).id;
  const circles = await getCirclesByUser(userId);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>My Circles</h1>
          <Link href="/circles/create" className="btn btn--accent">
            + New Circle
          </Link>
        </div>

        {circles.length === 0 ? (
          <EmptyState
            title="No circles yet"
            description="You haven't joined any savings circles yet. Browse open circles or create your own to get started."
            illustration="circles"
            ctas={[
              { label: "Browse circles", href: "/circles", variant: "primary" },
              { label: "Create a circle", href: "/circles/create", variant: "secondary" },
            ]}
          />
        ) : (
          <div className={styles.grid}>
            {circles.map((circle) => (
              <CircleCard key={circle.id} circle={circle} members={[]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
