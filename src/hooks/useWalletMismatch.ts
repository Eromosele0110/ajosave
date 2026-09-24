"use client";

import { useCallback, useEffect, useState } from "react";

/** The type of mismatch detected between the expected and connected wallet. */
export type MismatchType = "address" | "network" | "none";

export interface UseWalletMismatchReturn {
  /** True when the connected wallet does not match the expected address. */
  isMismatch: boolean;
  /** The specific kind of mismatch (or 'none' when everything is fine). */
  mismatchType: MismatchType;
  /**
   * Persist a dismissal for this session so the banner is not re-shown until
   * the user's next browser session (or the mismatch addresses change).
   */
  handleDismiss: () => void;
}

/**
 * Storage key format — includes both addresses so the dismissal is
 * invalidated automatically if either address changes.
 */
function dismissalKey(expected: string, connected: string): string {
  return `wallet_mismatch_dismissed:${expected}:${connected}`;
}

function isDismissed(expected: string, connected: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(dismissalKey(expected, connected)) === "1";
  } catch {
    return false;
  }
}

function persistDismissal(expected: string, connected: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(dismissalKey(expected, connected), "1");
  } catch {
    // sessionStorage may be unavailable (private browsing / storage full).
  }
}

/**
 * useWalletMismatch
 *
 * Detects when the wallet currently connected in Freighter does not match the
 * address stored on the user's account.
 *
 * @param expectedAddress  The wallet address from the user's session / DB.
 * @param currentWalletAddress  The live address from `useFreighterWallet`.
 */
export function useWalletMismatch(
  expectedAddress: string,
  currentWalletAddress: string | null
): UseWalletMismatchReturn {
  const [mismatchType, setMismatchType] = useState<MismatchType>("none");

  useEffect(() => {
    if (!currentWalletAddress) {
      // Wallet is not connected — no mismatch to surface.
      setMismatchType("none");
      return;
    }

    if (currentWalletAddress === expectedAddress) {
      setMismatchType("none");
      return;
    }

    // If the connected address doesn't look like a valid Stellar public key
    // (starts with 'G', 56 chars) we surface it as a 'network' mismatch —
    // the user is likely on a different Stellar network.
    const looksLikeStellarPubnet =
      typeof currentWalletAddress === "string" &&
      currentWalletAddress.length === 56 &&
      currentWalletAddress.startsWith("G");

    if (!looksLikeStellarPubnet) {
      setMismatchType("network");
      return;
    }

    // Both addresses are valid Stellar pubkeys but they don't match.
    // Check if the user has already dismissed this specific mismatch.
    if (isDismissed(expectedAddress, currentWalletAddress)) {
      setMismatchType("none");
      return;
    }

    setMismatchType("address");
  }, [expectedAddress, currentWalletAddress]);

  const handleDismiss = useCallback(() => {
    if (currentWalletAddress && currentWalletAddress !== expectedAddress) {
      persistDismissal(expectedAddress, currentWalletAddress);
    }
    setMismatchType("none");
  }, [expectedAddress, currentWalletAddress]);

  return {
    isMismatch: mismatchType !== "none",
    mismatchType,
    handleDismiss,
  };
}
