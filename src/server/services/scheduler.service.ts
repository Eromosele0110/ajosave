import { query } from "@/lib/db";
import {
  notifyPayoutReminder,
  notifyMissedContribution,
  notifyContributionReminder,
} from "./notification.service";
import { getMissedContributions } from "./contribution.service";
import type { Circle, Member } from "@/types";
import { addPayoutJob } from "@/lib/queue/payoutQueue";
import { withCronLock, CronLockError } from "./cron-lock";

/**
 * Send payout reminders 24 hours before scheduled payouts
 * This should be called by a cron job every hour
 */
export async function sendPayoutReminders(): Promise<void> {
  try {
    await withCronLock("sendPayoutReminders", _sendPayoutReminders);
  } catch (err) {
    if (err instanceof CronLockError) {
      console.warn(`[scheduler] ${err.message}`);
    } else {
      throw err;
    }
  }
}

async function _sendPayoutReminders(): Promise<void> {
  // Find circles with payouts due in 23-25 hours
  const { rows: circles } = await query<Circle>(
    `SELECT * FROM circles 
     WHERE status = 'active' 
     AND next_payout_at IS NOT NULL
     AND next_payout_at > NOW() + INTERVAL '23 hours'
     AND next_payout_at < NOW() + INTERVAL '25 hours'`
  );

  for (const circle of circles) {
    try {
      // Get the member who will receive the next payout
      const { rows: members } = await query<Member>(
        `SELECT * FROM members 
         WHERE circle_id = $1 
         AND position = $2 
         AND status = 'active'`,
        [circle.id, circle.currentCycle]
      );

      const recipient = members[0];
      if (!recipient) continue;

      const totalPot = (
        parseFloat(circle.contributionUsdc) *
        Number(
          (
            await query<{ count: string | number }>(
              "SELECT COUNT(*) as count FROM members WHERE circle_id = $1 AND status = 'active'",
              [circle.id]
            )
          ).rows[0]?.count || 0
        )
      ).toFixed(7);

      // Send reminder to recipient
      await notifyPayoutReminder(recipient.userId, circle.name, totalPot, 24);
    } catch (error) {
      console.error(`Failed to send payout reminder for circle ${circle.id}:`, error);
    }
  }
}

/**
 * Mark missed contributions and notify members after the grace period.
 * Grace period is configurable per circle (grace_period_hours after next_payout_at).
 * This should be called by a cron job daily.
 */
export async function processMissedContributions(): Promise<void> {
  try {
    await withCronLock("processMissedContributions", _processMissedContributions);
  } catch (err) {
    if (err instanceof CronLockError) {
      console.warn(`[scheduler] ${err.message}`);
    } else {
      throw err;
    }
  }
}

async function _processMissedContributions(): Promise<void> {
  // Find active circles where the grace period has elapsed
  const { rows: circles } = await query<Circle & { gracePeriodHours: number }>(
    `SELECT *, grace_period_hours as "gracePeriodHours" FROM circles 
     WHERE status = 'active' 
     AND next_payout_at IS NOT NULL
     AND next_payout_at + (grace_period_hours * INTERVAL '1 hour') < NOW()`
  );

  for (const circle of circles) {
    try {
      const missed = await getMissedContributions(circle.id, circle.currentCycle);

      for (const { memberId, userId } of missed) {
        // Mark member as defaulted
        await query("UPDATE members SET status = 'defaulted' WHERE id = $1", [memberId]);

        // Create missed contribution record
        await query(
          `INSERT INTO contributions (id, circle_id, member_id, cycle_number, amount_usdc, status, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'missed', NOW())
           ON CONFLICT (member_id, cycle_number) DO NOTHING`,
          [circle.id, memberId, circle.currentCycle, circle.contributionUsdc]
        );

        // Decrement reputation score (floor at 0)
        await query(
          `UPDATE users SET reputation_score = GREATEST(0, reputation_score - 10) WHERE id = $1`,
          [userId]
        );

        // Apply configurable penalty (record in penalties table)
        try {
          const penaltyPercent = Number((circle as any).penalty_percent ?? (circle as any).penaltyPercent ?? 10);
          const penaltyAmount = (parseFloat(circle.contributionUsdc) * (penaltyPercent / 100)).toFixed(7);
          await query(
            `INSERT INTO penalties (circle_id, member_id, cycle_number, amount_usdc, created_at)
             VALUES ($1,$2,$3,$4,NOW())`,
            [circle.id, memberId, circle.currentCycle, penaltyAmount]
          );
        } catch (err) {
          console.error("Failed to record penalty for defaulted member:", err);
        }

        // Send notification to member and notify creator (admin)
        await notifyMissedContribution(userId, circle.name, circle.contributionUsdc);
        try {
          const creatorId = (circle as any).creator_id ?? (circle as any).creatorId;
          if (creatorId) {
            const { notifyAdminOfDefault } = await import("@/server/services/notification.service");
            await notifyAdminOfDefault(creatorId, userId, circle.name, (parseFloat(circle.contributionUsdc) * (Number((circle as any).penalty_percent ?? (circle as any).penaltyPercent ?? 10) / 100)).toFixed(7));
          }
        } catch (err) {
          console.error("Failed to notify circle admin about default:", err);
        }
      }
    } catch (error) {
      console.error(`Failed to process missed contributions for circle ${circle.id}:`, error);
    }
  }
}

type ReminderWindow = { hoursLeft: number; lowerHours: number; upperHours: number };

const WINDOWS: ReminderWindow[] = [
  { hoursLeft: 24, lowerHours: 23, upperHours: 25 },
  { hoursLeft: 2, lowerHours: 1, upperHours: 3 },
];

/**
 * Send contribution reminders for both the 24h and 2h windows.
 * Idempotent: uses the contribution_reminders table to prevent duplicates.
 * Per-circle errors are caught and logged; they do not abort the run.
 */
export async function sendContributionReminders(): Promise<void> {
  try {
    await withCronLock("sendContributionReminders", _sendContributionReminders);
  } catch (err) {
    if (err instanceof CronLockError) {
      console.warn(`[scheduler] ${err.message}`);
    } else {
      throw err;
    }
  }
}

async function _sendContributionReminders(): Promise<void> {
  for (const { hoursLeft, lowerHours, upperHours } of WINDOWS) {
    const reminderType = `${hoursLeft}h`;

    const { rows: circles } = await query<Circle>(
      `SELECT id, name, status, next_payout_at as "nextPayoutAt",
              current_cycle as "currentCycle", contribution_usdc as "contributionUsdc"
       FROM circles
       WHERE status = 'active'
         AND next_payout_at IS NOT NULL
         AND next_payout_at > NOW() + ($1 * INTERVAL '1 hour')
         AND next_payout_at < NOW() + ($2 * INTERVAL '1 hour')`,
      [lowerHours, upperHours]
    );

    for (const circle of circles) {
      try {
        const { rows: members } = await query<{ id: string; userId: string }>(
          `SELECT m.id, m.user_id as "userId"
           FROM members m
           WHERE m.circle_id = $1
             AND m.status = 'active'`,
          [circle.id]
        );

        for (const member of members) {
          // Check if member has already confirmed their contribution for this cycle
          const { rows: confirmedRows } = await query(
            `SELECT 1 FROM contributions
             WHERE member_id = $1
               AND circle_id = $2
               AND cycle_number = $3
               AND status = 'confirmed'`,
            [member.id, circle.id, circle.currentCycle]
          );
          if (confirmedRows.length > 0) continue; // already confirmed — not a Pending_Contributor

          // Check if contribution is 'missed' — also not a Pending_Contributor
          const { rows: statusRows } = await query<{ status: string }>(
            `SELECT status FROM contributions
             WHERE member_id = $1
               AND circle_id = $2
               AND cycle_number = $3`,
            [member.id, circle.id, circle.currentCycle]
          );
          if (statusRows.length > 0 && statusRows[0].status === "missed") continue;

          // Check idempotency — has this reminder already been sent?
          const { rows: reminderRows } = await query(
            `SELECT 1 FROM contribution_reminders
             WHERE member_id = $1
               AND cycle_number = $2
               AND reminder_type = $3`,
            [member.id, circle.currentCycle, reminderType]
          );
          if (reminderRows.length > 0) continue; // already reminded this window/cycle

          // Send the reminder
          await notifyContributionReminder(
            member.userId,
            circle.name,
            circle.contributionUsdc,
            hoursLeft
          );

          // Record that we sent the reminder (idempotency insert)
          await query(
            `INSERT INTO contribution_reminders (id, member_id, cycle_number, reminder_type, sent_at)
             VALUES (gen_random_uuid(), $1, $2, $3, NOW())
             ON CONFLICT DO NOTHING`,
            [member.id, circle.currentCycle, reminderType]
          );
        }
      } catch (error) {
        console.error(`Failed to send contribution reminders for circle ${circle.id}:`, error);
      }
    }
  }
}

/**
 * Find circles with payouts due and enqueue payout jobs instead of processing inline.
 * This keeps the cron handler lightweight and moves long-running work to background workers.
 */
export async function processDueCycles(): Promise<void> {
  try {
    await withCronLock("processDueCycles", _processDueCycles);
  } catch (err) {
    if (err instanceof CronLockError) {
      console.warn(`[scheduler] ${err.message}`);
    } else {
      throw err;
    }
  }
}

async function _processDueCycles(): Promise<void> {
  const { rows: circles } = await query<{ id: string; currentCycle: number }>(
    `SELECT id, current_cycle as "currentCycle" FROM circles
     WHERE status = 'active' AND next_payout_at IS NOT NULL AND next_payout_at <= NOW()`
  );

  for (const circle of circles) {
    try {
      // Skip if payout record already exists for this cycle
      const { rows: existing } = await query(
        `SELECT 1 FROM payouts WHERE circle_id = $1 AND cycle_number = $2 LIMIT 1`,
        [circle.id, circle.currentCycle]
      );
      if (existing.length > 0) continue;

      // Gate: only proceed if all active members have a confirmed contribution this cycle
      const { rows: unpaid } = await query(
        `SELECT m.id FROM members m
         WHERE m.circle_id = $1 AND m.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM contributions c
             WHERE c.member_id = m.id
               AND c.cycle_number = $2
               AND c.status = 'confirmed'
           )`,
        [circle.id, circle.currentCycle]
      );

      if (unpaid.length > 0) {
        console.log(`[scheduler] Skipping payout for circle ${circle.id} — ${unpaid.length} member(s) have not fully paid`);
        continue;
      }

      await addPayoutJob(circle.id, circle.currentCycle);
      console.log(`[scheduler] Enqueued payout job for circle ${circle.id} cycle ${circle.currentCycle}`);
    } catch (err) {
      console.error(`[scheduler] Failed to enqueue payout for circle ${circle.id}:`, err);
    }
  }
}
