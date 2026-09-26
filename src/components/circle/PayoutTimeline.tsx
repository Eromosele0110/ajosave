"use client";

/**
 * PayoutTimeline
 *
 * A mobile-first vertical timeline showing each member's payout event in
 * rotation order. Supports past / current / upcoming states, a "You" badge
 * for the current user, collapsible overflow, and a skeleton loading state.
 *
 * Usage:
 *   <PayoutTimeline members={members} circle={circle} currentUserId={userId} />
 */

import { useState } from "react";
import type { Circle, Member } from "@/types";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import styles from "./PayoutTimeline.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PayoutTimelineProps {
  /** All circle members, in any order — component sorts by position. */
  members: Member[];
  /** The parent circle (used for status, currentCycle, nextPayoutAt). */
  circle: Circle;
  /** Current authenticated user ID — used to render the "You" badge. */
  currentUserId?: string;
  /** While true, renders skeleton placeholder rows instead of real items. */
  loading?: boolean;
  /** Number of upcoming items to show before the "Show all" toggle appears.
   *  @default 3
   */
  previewCount?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate the estimated payout date for a given cycle position.
 * For positions before the current cycle the date is unknown (already paid).
 * For the current cycle we use circle.nextPayoutAt if available.
 * For future cycles we project forward from nextPayoutAt by cycleFrequency.
 */
function estimatePayoutDate(
  circle: Circle,
  position: number
): Date | null {
  if (!circle.nextPayoutAt) return null;

  const base = new Date(circle.nextPayoutAt);
  const cyclesAhead = position - circle.currentCycle;

  if (cyclesAhead < 0) return null; // already paid
  if (cyclesAhead === 0) return base; // current cycle

  const msPerCycle =
    circle.cycleFrequency === "weekly"
      ? 7 * 24 * 60 * 60 * 1000
      : circle.cycleFrequency === "biweekly"
      ? 14 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000; // monthly ≈ 30 days

  return new Date(base.getTime() + cyclesAhead * msPerCycle);
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getItemStatus(
  member: Member,
  circle: Circle
): "past" | "current" | "upcoming" {
  if (member.hasReceivedPayout) return "past";
  if (circle.status === "active" && member.position === circle.currentCycle)
    return "current";
  return "upcoming";
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonItem() {
  return (
    <li className={styles.skeletonItem} aria-hidden="true">
      <div className={styles.skeletonDot} />
      <div className={styles.skeletonContent}>
        <div className={`${styles.skeletonLine} ${styles.skeletonLineLong}`} />
        <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
      </div>
    </li>
  );
}

// ─── Timeline item ────────────────────────────────────────────────────────────

interface TimelineItemProps {
  member: Member;
  circle: Circle;
  isMe: boolean;
}

function TimelineItem({ member, circle, isMe }: TimelineItemProps) {
  const status = getItemStatus(member, circle);
  const payoutDate = estimatePayoutDate(circle, member.position);
  const displayName = member.displayName ?? `Member ${member.userId.slice(0, 8)}…`;

  const itemClasses = [
    styles.item,
    status === "current" ? styles.itemCurrent : "",
    status === "past" ? styles.itemPast : "",
    isMe ? styles.itemMe : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={itemClasses}
      aria-current={status === "current" ? "true" : undefined}
      aria-label={`Cycle ${member.position}: ${displayName}${isMe ? " (you)" : ""}, ${status}`}
    >
      {/* Dot / cycle number */}
      <div className={styles.dot} aria-hidden="true">
        {member.position}
      </div>

      {/* Content */}
      <div className={styles.content}>
        <div className={styles.row}>
          <div className={styles.memberInfo}>
            <MemberAvatar
              displayName={member.displayName}
              userId={member.userId}
            />
            <span className={styles.memberName} title={displayName}>
              {displayName}
            </span>
            {isMe && (
              <span className={styles.youBadge} aria-label="This is you">
                You
              </span>
            )}
          </div>
          {payoutDate && (
            <time
              className={styles.datetime}
              dateTime={payoutDate.toISOString()}
            >
              {formatDate(payoutDate)}
            </time>
          )}
        </div>

        <div className={styles.statusBadges}>
          {status === "past" && (
            <span className={`${styles.tag} ${styles.tagDone}`}>
              Paid out ✓
            </span>
          )}
          {status === "current" && (
            <span className={`${styles.tag} ${styles.tagActive}`}>
              Receiving now
            </span>
          )}
          {status === "upcoming" && (
            <span className={`${styles.tag} ${styles.tagUpcoming}`}>
              Cycle {member.position}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PayoutTimeline({
  members,
  circle,
  currentUserId,
  loading = false,
  previewCount = 3,
}: PayoutTimelineProps) {
  const [showAll, setShowAll] = useState(false);

  // Sort members by payout position ascending
  const sorted = [...members].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );

  // Separate into sections for correct "show more" logic:
  // always show past + current, collapse upcoming beyond previewCount
  const past = sorted.filter((m) => getItemStatus(m, circle) === "past");
  const current = sorted.filter(
    (m) => getItemStatus(m, circle) === "current"
  );
  const upcoming = sorted.filter(
    (m) => getItemStatus(m, circle) === "upcoming"
  );

  const upcomingVisible = showAll
    ? upcoming
    : upcoming.slice(0, previewCount);

  const visibleItems = [...past, ...current, ...upcomingVisible];
  const hiddenCount = upcoming.length - upcomingVisible.length;

  // ── Skeleton state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className={styles.container} aria-label="Payout timeline loading">
        <div className={styles.header}>
          <h2 className={styles.title}>Payout Timeline</h2>
        </div>
        <ol className={styles.timeline} aria-busy="true">
          {Array.from({ length: previewCount }).map((_, i) => (
            <SkeletonItem key={i} />
          ))}
        </ol>
      </section>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (sorted.length === 0) {
    return (
      <section className={styles.container} aria-label="Payout timeline">
        <div className={styles.header}>
          <h2 className={styles.title}>Payout Timeline</h2>
        </div>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
          No members yet.
        </p>
      </section>
    );
  }

  // ── Populated timeline ─────────────────────────────────────────────────────
  return (
    <section className={styles.container} aria-label="Payout timeline">
      <div className={styles.header}>
        <h2 className={styles.title}>
          Payout Timeline{" "}
          <span className={styles.count}>({sorted.length})</span>
        </h2>
      </div>

      <ol className={styles.timeline} aria-label="Payout rotation order">
        {visibleItems.map((member) => (
          <TimelineItem
            key={member.id}
            member={member}
            circle={circle}
            isMe={!!currentUserId && member.userId === currentUserId}
          />
        ))}
      </ol>

      {/* Show all / collapse toggle */}
      {(hiddenCount > 0 || (showAll && upcoming.length > previewCount)) && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setShowAll((prev) => !prev)}
          aria-expanded={showAll}
          aria-controls="payout-timeline-list"
        >
          {showAll
            ? "Show less ↑"
            : `Show all ${upcoming.length} upcoming →`}
        </button>
      )}
    </section>
  );
}
