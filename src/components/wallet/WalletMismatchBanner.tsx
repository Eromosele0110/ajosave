"use client";

import { useEffect, useState } from "react";
import styles from "./WalletMismatchBanner.module.css";

/** Truncates a Stellar address to first 6 … last 4 chars. */
function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type BannerState = "idle" | "mismatch" | "resolved";

export interface WalletMismatchBannerProps {
  /** The wallet address stored in the session / DB for this user. */
  expectedAddress: string;
  /** The address currently connected in Freighter (null = not connected). */
  connectedAddress: string | null;
  /** Callback to trigger a wallet switch (e.g. re-connect flow). */
  onSwitch: () => void;
  /** Callback to disconnect the current wallet. */
  onDisconnect: () => void;
}

/**
 * WalletMismatchBanner
 *
 * Shows an amber warning banner when the connected wallet does not match
 * the expected address on the user's account. Has three states:
 *
 * - idle      — addresses match (or no wallet connected), renders nothing.
 * - mismatch  — addresses differ, shows the banner with action buttons.
 * - resolved  — user switched to the correct wallet, shows a brief success
 *               message before hiding itself.
 */
export function WalletMismatchBanner({
  expectedAddress,
  connectedAddress,
  onSwitch,
  onDisconnect,
}: WalletMismatchBannerProps): JSX.Element | null {
  const [bannerState, setBannerState] = useState<BannerState>("idle");

  useEffect(() => {
    if (!connectedAddress) {
      // No wallet connected — don't show the banner.
      setBannerState("idle");
      return;
    }

    if (connectedAddress === expectedAddress) {
      if (bannerState === "mismatch") {
        // The user just switched to the correct wallet — show resolved briefly.
        setBannerState("resolved");
        const timer = setTimeout(() => setBannerState("idle"), 3000);
        return () => clearTimeout(timer);
      }
      // Already idle (or resolved fading out) — keep as-is.
      return;
    }

    // Addresses differ → show the mismatch banner.
    setBannerState("mismatch");
  }, [connectedAddress, expectedAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  if (bannerState === "idle") {
    return null;
  }

  if (bannerState === "resolved") {
    return (
      <div className={styles.resolved} role="status" aria-live="polite">
        <span className={styles.resolvedIcon} aria-hidden="true">✓</span>
        Wallet switched successfully — you&apos;re now using the correct account.
      </div>
    );
  }

  // bannerState === "mismatch"
  return (
    <div
      className={styles.banner}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span className={styles.icon} aria-hidden="true">⚠</span>

      <div className={styles.body}>
        <p className={styles.title}>Wallet mismatch detected</p>
        <p className={styles.description}>
          The connected wallet does not match the Stellar address registered to
          your account. Switch wallets or disconnect before performing any
          transactions.
        </p>

        <div
          className={styles.addresses}
          aria-label="Address comparison"
        >
          <div className={styles.addressRow}>
            <span className={styles.addressLabel}>Expected:</span>
            <span
              className={`${styles.addressPill} ${styles["addressPill--expected"]}`}
              title={expectedAddress}
              aria-label={`Expected address: ${expectedAddress}`}
            >
              {truncateAddress(expectedAddress)}
            </span>
          </div>

          {connectedAddress && (
            <div className={styles.addressRow}>
              <span className={styles.addressLabel}>Connected:</span>
              <span
                className={styles.addressPill}
                title={connectedAddress}
                aria-label={`Connected address: ${connectedAddress}`}
              >
                {truncateAddress(connectedAddress)}
              </span>
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.switchButton}
            onClick={onSwitch}
            aria-label="Switch to the expected wallet"
          >
            Switch wallet
          </button>
          <button
            type="button"
            className={styles.disconnectButton}
            onClick={onDisconnect}
            aria-label="Disconnect the current wallet"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
