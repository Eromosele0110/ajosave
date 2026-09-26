/**
 * Hook for managing realtime reconnection logic with exponential backoff.
 *
 * Features:
 * - Tracks reconnect attempt count and status
 * - Exponential backoff: 1s → 2s → 4s → 8s → 16s (max 30s)
 * - Up to 5 automatic reconnect attempts before entering 'failed' state
 * - Manual reconnect for user-triggered retries
 * - Persists last connected timestamp in localStorage
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ReconnectStatus = "idle" | "connecting" | "connected" | "failed";

export interface UseRealtimeReconnectOptions {
  /** Called to establish / re-establish the connection */
  connect: () => void;
  /** Whether the socket is currently connected */
  isConnected: boolean;
  /** Maximum number of automatic reconnect attempts before giving up */
  maxReconnectAttempts?: number;
}

export interface UseRealtimeReconnectReturn {
  reconnectAttempts: number;
  reconnectStatus: ReconnectStatus;
  /** Seconds remaining until the next automatic retry (null when not counting down) */
  retryInSeconds: number | null;
  lastConnectedAt: Date | null;
  /** Trigger an immediate reconnect attempt, resetting the attempt counter */
  manualReconnect: () => void;
}

const LAST_CONNECTED_KEY = "ajosave:lastConnectedAt";
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

function getBackoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s — capped at 30s
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
}

export function useRealtimeReconnect({
  connect,
  isConnected,
  maxReconnectAttempts = 5,
}: UseRealtimeReconnectOptions): UseRealtimeReconnectReturn {
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [reconnectStatus, setReconnectStatus] = useState<ReconnectStatus>("idle");
  const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
  const [lastConnectedAt, setLastConnectedAt] = useState<Date | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(LAST_CONNECTED_KEY);
    return stored ? new Date(stored) : null;
  });

  // Stable ref so timers always close over the latest values
  const attemptsRef = useRef(reconnectAttempts);
  const statusRef = useRef(reconnectStatus);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  attemptsRef.current = reconnectAttempts;
  statusRef.current = reconnectStatus;

  // ── helpers ──────────────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setRetryInSeconds(null);
  }, []);

  const scheduleReconnect = useCallback(
    (attempt: number) => {
      clearTimers();

      if (attempt >= maxReconnectAttempts) {
        setReconnectStatus("failed");
        return;
      }

      const delayMs = getBackoffMs(attempt);
      const delaySec = Math.ceil(delayMs / 1000);

      setRetryInSeconds(delaySec);

      // Countdown ticker
      let remaining = delaySec;
      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        setRetryInSeconds(remaining > 0 ? remaining : null);
        if (remaining <= 0 && countdownTimerRef.current !== null) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
      }, 1000);

      // Actual reconnect attempt
      retryTimerRef.current = setTimeout(() => {
        setReconnectStatus("connecting");
        setReconnectAttempts((prev) => prev + 1);
        connect();
      }, delayMs);
    },
    [clearTimers, connect, maxReconnectAttempts]
  );

  // ── react to connection changes ───────────────────────────────────────────

  useEffect(() => {
    if (isConnected) {
      clearTimers();
      setReconnectAttempts(0);
      setReconnectStatus("connected");
      const now = new Date();
      setLastConnectedAt(now);
      if (typeof window !== "undefined") {
        localStorage.setItem(LAST_CONNECTED_KEY, now.toISOString());
      }
    } else {
      // Only start reconnecting if we were previously connected or connecting
      if (statusRef.current === "connected" || statusRef.current === "connecting") {
        scheduleReconnect(attemptsRef.current);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // ── manual reconnect ──────────────────────────────────────────────────────

  const manualReconnect = useCallback(() => {
    clearTimers();
    setReconnectAttempts(0);
    setReconnectStatus("connecting");
    connect();
  }, [clearTimers, connect]);

  // ── cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return {
    reconnectAttempts,
    reconnectStatus,
    retryInSeconds,
    lastConnectedAt,
    manualReconnect,
  };
}
