/**
 * Tests for useWalletMismatch hook
 *
 * We use @testing-library/react's renderHook utility to exercise the hook
 * in a real React lifecycle.
 */
import { renderHook, act } from "@testing-library/react";
import { useWalletMismatch } from "@/hooks/useWalletMismatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPECTED = "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456";
const CONNECTED = "GXYZ1234567890XYZABC1234567890XYZABC1234567890XYZABC12345";

function makeAddress(prefix: string): string {
  // Valid Stellar pubnet address: starts with 'G', 56 chars total.
  return (prefix + "X".repeat(56)).slice(0, 56);
}

const ADDR_A = makeAddress("GA");
const ADDR_B = makeAddress("GB");

// ---------------------------------------------------------------------------
// sessionStorage mock helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWalletMismatch", () => {
  describe("mismatchType: none", () => {
    it("returns none when no wallet is connected (null)", () => {
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, null)
      );

      expect(result.current.isMismatch).toBe(false);
      expect(result.current.mismatchType).toBe("none");
    });

    it("returns none when connected address matches expected", () => {
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, ADDR_A)
      );

      expect(result.current.isMismatch).toBe(false);
      expect(result.current.mismatchType).toBe("none");
    });

    it("returns none when mismatch was previously dismissed in the session", () => {
      // Pre-populate sessionStorage as if the user already dismissed this pair.
      sessionStorage.setItem(
        `wallet_mismatch_dismissed:${ADDR_A}:${ADDR_B}`,
        "1"
      );

      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, ADDR_B)
      );

      expect(result.current.isMismatch).toBe(false);
      expect(result.current.mismatchType).toBe("none");
    });
  });

  describe("mismatchType: address", () => {
    it("returns address mismatch when both addresses are valid but differ", () => {
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, ADDR_B)
      );

      expect(result.current.isMismatch).toBe(true);
      expect(result.current.mismatchType).toBe("address");
    });

    it("returns address when addresses look like valid Stellar pubkeys but differ", () => {
      const { result } = renderHook(() =>
        useWalletMismatch(EXPECTED, CONNECTED)
      );

      expect(result.current.mismatchType).toBe("address");
    });
  });

  describe("mismatchType: network", () => {
    it("returns network mismatch for a non-Stellar address (wrong network)", () => {
      // A testnet address might not start with 'G', or might have wrong length.
      const testnetAddress = "TCUSTOM_TESTNET_ADDRESS"; // not 56 chars / no 'G'
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, testnetAddress)
      );

      expect(result.current.isMismatch).toBe(true);
      expect(result.current.mismatchType).toBe("network");
    });

    it("returns network mismatch for an address that does not start with G", () => {
      const weirdAddress = "X" + "A".repeat(55); // 56 chars but starts with X
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, weirdAddress)
      );

      expect(result.current.mismatchType).toBe("network");
    });
  });

  describe("handleDismiss", () => {
    it("sets mismatchType to none immediately", () => {
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, ADDR_B)
      );

      expect(result.current.mismatchType).toBe("address");

      act(() => {
        result.current.handleDismiss();
      });

      expect(result.current.isMismatch).toBe(false);
      expect(result.current.mismatchType).toBe("none");
    });

    it("persists the dismissal in sessionStorage", () => {
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, ADDR_B)
      );

      act(() => {
        result.current.handleDismiss();
      });

      expect(
        sessionStorage.getItem(
          `wallet_mismatch_dismissed:${ADDR_A}:${ADDR_B}`
        )
      ).toBe("1");
    });

    it("does not write to sessionStorage when there is no mismatch", () => {
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, ADDR_A)
      );

      act(() => {
        result.current.handleDismiss();
      });

      // No key should have been written
      expect(sessionStorage.length).toBe(0);
    });

    it("does not write to sessionStorage when wallet is null", () => {
      const { result } = renderHook(() =>
        useWalletMismatch(ADDR_A, null)
      );

      act(() => {
        result.current.handleDismiss();
      });

      expect(sessionStorage.length).toBe(0);
    });
  });

  describe("reactive updates", () => {
    it("transitions from mismatch to none when the wallet switches to the expected address", () => {
      let connectedAddress: string | null = ADDR_B;

      const { result, rerender } = renderHook(
        ({ connected }: { connected: string | null }) =>
          useWalletMismatch(ADDR_A, connected),
        { initialProps: { connected: ADDR_B } }
      );

      expect(result.current.mismatchType).toBe("address");

      // Simulate the user switching to the correct wallet
      act(() => {
        rerender({ connected: ADDR_A });
      });

      expect(result.current.isMismatch).toBe(false);
      expect(result.current.mismatchType).toBe("none");
    });

    it("transitions from none to mismatch when a different wallet is connected", () => {
      const { result, rerender } = renderHook(
        ({ connected }: { connected: string | null }) =>
          useWalletMismatch(ADDR_A, connected),
        { initialProps: { connected: ADDR_A } }
      );

      expect(result.current.mismatchType).toBe("none");

      act(() => {
        rerender({ connected: ADDR_B });
      });

      expect(result.current.mismatchType).toBe("address");
    });
  });
});
