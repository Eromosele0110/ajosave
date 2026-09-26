"use client";

import type { ReconnectStatus } from "@/hooks/useRealtimeReconnect";
import styles from "./ConnectionStatus.module.css";

interface ConnectionStatusProps {
  isConnected: boolean;
  lastUpdate?: Date;
  /** Number of reconnect attempts made so far (optional, for enhanced display) */
  reconnectAttempts?: number;
  /** Current reconnect status (optional, for enhanced display) */
  reconnectStatus?: ReconnectStatus;
}

export function ConnectionStatus({
  isConnected,
  lastUpdate,
  reconnectAttempts,
  reconnectStatus,
}: ConnectionStatusProps) {
  const isReconnecting = reconnectStatus === "connecting";
  const hasFailed = reconnectStatus === "failed";

  let statusLabel: string;
  let statusText: string;

  if (isConnected) {
    statusLabel = "Live connection";
    statusText = "Live";
  } else if (isReconnecting) {
    const attemptInfo =
      reconnectAttempts !== undefined && reconnectAttempts > 0
        ? ` (${reconnectAttempts})`
        : "";
    statusLabel = `Reconnecting${attemptInfo}`;
    statusText = `Reconnecting${attemptInfo}`;
  } else if (hasFailed) {
    statusLabel = "Connection failed";
    statusText = "Failed";
  } else {
    statusLabel = "Disconnected";
    statusText = "Disconnected";
  }

  return (
    <div className={styles.container}>
      <div
        className={`${styles.indicator} ${isConnected ? styles.connected : styles.disconnected}`}
        aria-label={statusLabel}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.text}>{statusText}</span>
      </div>
      {lastUpdate && isConnected && (
        <span
          className={styles.timestamp}
          aria-label={`Last updated at ${new Date(lastUpdate).toLocaleTimeString()}`}
        >
          Updated {new Date(lastUpdate).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
