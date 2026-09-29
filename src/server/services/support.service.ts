import { query } from "@/lib/db";
import logger from "@/lib/logger";
import { randomUUID } from "crypto";

export type SupportTicketCategory =
  | "payment_issue"
  | "circle_dispute"
  | "account_access"
  | "payout_issue"
  | "general"
  | "other";

export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";

export interface SupportTicket {
  id: string;
  userId: string;
  category: SupportTicketCategory;
  subject: string;
  description: string;
  status: SupportTicketStatus;
  circleId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSupportTicketInput {
  userId: string;
  category: SupportTicketCategory;
  subject: string;
  description: string;
  circleId?: string;
}

export const VALID_CATEGORIES: readonly SupportTicketCategory[] = [
  "payment_issue",
  "circle_dispute",
  "account_access",
  "payout_issue",
  "general",
  "other",
];

export function isValidCategory(cat: string): cat is SupportTicketCategory {
  return (VALID_CATEGORIES as readonly string[]).includes(cat);
}

// In-memory fallback if the support_tickets table has not been migrated yet
const inMemoryTickets: SupportTicket[] = [];

/**
 * Create a new support ticket for the given user.
 *
 * Writes to PostgreSQL when the support_tickets table exists.
 * Falls back to an in-process store with a prominent warning otherwise,
 * so the endpoint remains functional before the migration is applied.
 */
export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicket> {
  const id = randomUUID();
  const now = new Date();

  const ticket: SupportTicket = {
    id,
    userId: input.userId,
    category: input.category,
    subject: input.subject.trim(),
    description: input.description.trim(),
    status: "open",
    circleId: input.circleId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await query(
      `INSERT INTO support_tickets
         (id, user_id, category, subject, description, status, circle_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        input.userId,
        input.category,
        ticket.subject,
        ticket.description,
        "open",
        input.circleId ?? null,
        now,
        now,
      ]
    );
    logger.info(
      { ticketId: id, userId: input.userId, category: input.category },
      "support ticket created"
    );
  } catch (err) {
    // Table may not exist yet — fall back to in-memory and warn ops team
    logger.warn(
      { err: err instanceof Error ? err.message : err, ticketId: id },
      "support_tickets table unavailable — ticket stored in memory only"
    );
    inMemoryTickets.push(ticket);
  }

  return ticket;
}

/**
 * Return all support tickets submitted by the given user, newest first.
 */
export async function getSupportTicketsByUser(userId: string): Promise<SupportTicket[]> {
  try {
    const { rows } = await query<{
      id: string;
      user_id: string;
      category: string;
      subject: string;
      description: string;
      status: string;
      circle_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, category, subject, description, status, circle_id,
              created_at, updated_at
       FROM support_tickets
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      category: r.category as SupportTicketCategory,
      subject: r.subject,
      description: r.description,
      status: r.status as SupportTicketStatus,
      circleId: r.circle_id ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch {
    return inMemoryTickets.filter((t) => t.userId === userId);
  }
}

/**
 * Fetch a single ticket by ID, scoped to the requesting user (ownership check).
 * Returns null when the ticket does not exist or belongs to a different user.
 */
export async function getSupportTicketById(
  id: string,
  userId: string
): Promise<SupportTicket | null> {
  try {
    const { rows } = await query<{
      id: string;
      user_id: string;
      category: string;
      subject: string;
      description: string;
      status: string;
      circle_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, category, subject, description, status, circle_id,
              created_at, updated_at
       FROM support_tickets
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      category: r.category as SupportTicketCategory,
      subject: r.subject,
      description: r.description,
      status: r.status as SupportTicketStatus,
      circleId: r.circle_id ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  } catch {
    return inMemoryTickets.find((t) => t.id === id && t.userId === userId) ?? null;
  }
}
