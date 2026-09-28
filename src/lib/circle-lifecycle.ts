/**
 * Circle lifecycle state machine (#35).
 *
 *   open ──start──▶ active ──complete──▶ completed
 *    │               │  ▲
 *    │             pause resume
 *    │               ▼  │
 *    │             paused
 *    └──cancel──▶ cancelled ◀──cancel── (active | paused)
 *
 * `completed` and `cancelled` are terminal.
 */
import { conflict, badRequest } from "./errors";

export const CIRCLE_STATUSES = ["open", "active", "paused", "completed", "cancelled"] as const;
export type CircleStatus = (typeof CIRCLE_STATUSES)[number];

export type CircleEvent = "start" | "pause" | "resume" | "complete" | "cancel";

const TRANSITIONS: Record<CircleStatus, Partial<Record<CircleEvent, CircleStatus>>> = {
  open: { start: "active", cancel: "cancelled" },
  active: { pause: "paused", complete: "completed", cancel: "cancelled" },
  paused: { resume: "active", cancel: "cancelled" },
  completed: {},
  cancelled: {},
};

export interface CircleSnapshot {
  status: string;
  memberCount: number;
  maxMembers: number;
  currentCycle: number;
}

export function isCircleStatus(value: unknown): value is CircleStatus {
  return typeof value === "string" && (CIRCLE_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: CircleStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

export function allowedEvents(status: CircleStatus): CircleEvent[] {
  return Object.keys(TRANSITIONS[status]) as CircleEvent[];
}

/** Computes the next status, enforcing guards. Throws AppError on invalid transitions. */
export function transition(circle: CircleSnapshot, event: CircleEvent): CircleStatus {
  if (!isCircleStatus(circle.status)) {
    throw badRequest(`Unknown circle status: ${circle.status}`);
  }
  const next = TRANSITIONS[circle.status][event];
  if (!next) {
    throw conflict(`Cannot ${event} a circle that is ${circle.status}`, {
      status: circle.status,
      event,
      allowed: allowedEvents(circle.status),
    });
  }
  if (event === "start" && circle.memberCount < 2) {
    throw conflict("A circle needs at least 2 members to start");
  }
  if (event === "start" && circle.memberCount > circle.maxMembers) {
    throw conflict("Circle has more members than max_members");
  }
  if (event === "complete" && circle.currentCycle < circle.maxMembers) {
    throw conflict("Circle cannot complete before every member has received a payout");
  }
  return next;
}
