"use client";

import { useState } from "react";
import type { ReconnectStatus } from "@/hooks/useRealtimeReconnect";
import styles from "./ReconnectBanner.module.css";

interface ReconnectBannerProps {
  /** Whether the socket is currently disconnected */
  isDisconnected: boolean;
  reconnectAttempts: number;
  reconnectStatus: ReconnectStatus;
  /** Seconds until the next automatic retry */
  retryInSeconds: number | null;
  /** Maximum allowed automatic reconnect attempts */
  maxReconnectAttempts?: number;
  /** Callback to trigger an immediate manual reconnect */
  onManualReconnect: () => void;
}

export function ReconnectBanner({
  isDisconnected,
  reconnectAttempts,
  reconnectStatus,
  retryInSeconds,
  maxReconnectAttempts = 5,
  onManualReconnect,
}: ReconnectBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const isFailed = reconnectStatus === "failed" || reconnectAttempts >= maxReconnectAttempts;
  const isConnecting = reconnectStatus === "connecting";

  // Show the banner whenever disconnected and not dismissed
  if (!isDisconnected || dismissed) {
    return null;
  }

  function handleReload() {
    window.location.reload();
  }

  function handleDismiss() {
    setDismissed(true);
  }

  function buildStatusMessage() {
    if (isFailed) {
      return (
        <span className={styles.message}>
          <strong>Connection failed</strong> — reload the page to try again.
        </span>
      );
    }

    if (isConnecting) {
      return (
        <span className={styles.message}>
          <strong>Reconnecting…</strong>
          {reconnectAttempts > 0 && (
            <> Attempt {reconnectAttempts} of {maxReconnectAttempts}</>
          )}
        </span>
      );
    }

    return (
      <span className={styles.message}>
        <strong>You&apos;re offline.</strong>
        {retryInSeconds !== null ? (
          <span className={styles.countdown}>
            {" "}Retrying in {retryInSeconds}s…
          </span>
        ) : (
          " Connection lost."
        )}
        {reconnectAttempts > 0 && (
          <> (Attempt {reconnectAttempts} of {maxReconnectAttempts})</>
        )}
      </span>
    );
  }

  return (
    <div
      className={`${styles.banner} ${isFailed ? styles.bannerFailed : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="reconnect-banner"
    >
      <div className={styles.left}>
        {/* Wifi-off icon */}
        <svg
          className={styles.icon}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {isConnecting ? (
            // Spinner path when actively reconnecting
            <circle
              className={styles.spinning}
              cx="12"
              cy="12"
              r="9"
              strokeDasharray="28"
              strokeDashoffset="10"
            />
          ) : (
            // Wifi-off paths
            <>
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </>
          )}
        </svg>

        {buildStatusMessage()}
      </div>

      <div className={styles.actions}>
        {isFailed ? (
          <button
            className={styles.reloadBtn}
            onClick={handleReload}
            type="button"
          >
            Reload page
          </button>
        ) : (
          <button
            className={styles.reconnectBtn}
            onClick={onManualReconnect}
            disabled={isConnecting}
            type="button"
            aria-label="Reconnect now"
          >
            {isConnecting ? "Connecting…" : "Reconnect Now"}
          </button>
        )}

        <button
          className={styles.dismissBtn}
          onClick={handleDismiss}
          type="button"
          aria-label="Dismiss connection warning"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
