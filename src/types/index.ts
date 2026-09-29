// ─── User ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  phone: string;
  displayName: string;
  email?: string;
  stellarPublicKey?: string;
  reputationScore: number; // 0–100, built from on-time contributions
  createdAt: Date;
}

// ─── Circle ───────────────────────────────────────────────────────────────────
export type CircleStatus = "open" | "active" | "completed" | "cancelled";
export type CycleFrequency = "weekly" | "biweekly" | "monthly";

export interface Circle {
  id: string;
  name: string;
  creatorId: string;
  contributionUsdc: string; // per-member per-cycle amount
  contributionNgn: number;
  maxMembers: number;
  cycleFrequency: CycleFrequency;
  status: CircleStatus;
  contractId?: string; // deployed Soroban circle contract
  currentCycle: number; // 1-indexed
  nextPayoutAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Membership ───────────────────────────────────────────────────────────────
export type MemberStatus = "pending" | "active" | "defaulted" | "completed";

export interface Member {
  id: string;
  circleId: string;
  userId: string;
  position: number; // payout order (1 = first to receive)
  status: MemberStatus;
  hasReceivedPayout: boolean;
  joinedAt: Date;
}

// ─── Contribution ─────────────────────────────────────────────────────────────
export type ContributionStatus = "pending" | "confirmed" | "missed";

export interface Contribution {
  id: string;
  circleId: string;
  memberId: string;
  cycleNumber: number;
  amountUsdc: string;
  status: ContributionStatus;
  txHash?: string;
  createdAt: Date;
}

// ─── Payout ───────────────────────────────────────────────────────────────────
export interface Payout {
  id: string;
  circleId: string;
  recipientMemberId: string;
  cycleNumber: number;
  amountUsdc: string;
  txHash: string;
  paidAt: Date;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
export interface CircleMessage {
  id: string;
  circleId: string;
  userId: string;
  displayName: string;
  content: string;
  createdAt: Date;
}

// ─── Circle discovery filters ─────────────────────────────────────────────────

/**
 * Filter parameters accepted by GET /api/v1/circles.
 *
 * All fields are optional — omitting a field means "no constraint".
 * - `status`            Filter by circle lifecycle status.
 * - `frequency`         Filter by contribution cycle frequency.
 * - `minAmount`         Minimum contributionNgn (inclusive).
 * - `maxAmount`         Maximum contributionNgn (inclusive).
 * - `maxMembers`        Exact maximum-member count (e.g. show only 5-person circles).
 * - `search`            Case-insensitive substring match against circle name.
 */
export interface CircleFilters {
  status?: CircleStatus;
  frequency?: CycleFrequency;
  minAmount?: number;
  maxAmount?: number;
  maxMembers?: number;
  search?: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────
export interface ApiSuccess<T> {
  success: true;
  data: T;
}
export interface ApiError {
  success: false;
  error: string;
  code?: string;
}
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
