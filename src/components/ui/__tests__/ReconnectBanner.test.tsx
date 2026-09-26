import { render, screen, fireEvent } from "@testing-library/react";
import { ReconnectBanner } from "../ReconnectBanner";
import type { ReconnectStatus } from "@/hooks/useRealtimeReconnect";

// window.location.reload is not implemented in jsdom — stub it out
const mockReload = jest.fn();
Object.defineProperty(window, "location", {
  value: { ...window.location, reload: mockReload },
  writable: true,
});

function renderBanner(overrides: Partial<React.ComponentProps<typeof ReconnectBanner>> = {}) {
  const defaults: React.ComponentProps<typeof ReconnectBanner> = {
    isDisconnected: true,
    reconnectAttempts: 0,
    reconnectStatus: "idle" as ReconnectStatus,
    retryInSeconds: null,
    maxReconnectAttempts: 5,
    onManualReconnect: jest.fn(),
  };
  return render(<ReconnectBanner {...defaults} {...overrides} />);
}

describe("ReconnectBanner", () => {
  beforeEach(() => {
    mockReload.mockClear();
  });

  describe("visibility", () => {
    it("renders when isDisconnected=true", () => {
      renderBanner({ isDisconnected: true });
      expect(screen.getByTestId("reconnect-banner")).toBeInTheDocument();
    });

    it("does not render when isDisconnected=false", () => {
      renderBanner({ isDisconnected: false });
      expect(screen.queryByTestId("reconnect-banner")).not.toBeInTheDocument();
    });

    it("hides after clicking the dismiss button", () => {
      renderBanner({ isDisconnected: true });
      fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
      expect(screen.queryByTestId("reconnect-banner")).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has role='status' for screen reader live announcements", () => {
      renderBanner();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("has aria-live='polite'", () => {
      renderBanner();
      expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    });

    it("has aria-atomic='true'", () => {
      renderBanner();
      expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    });
  });

  describe("idle / disconnected state", () => {
    it("shows 'You\\'re offline.' message", () => {
      renderBanner({ reconnectStatus: "idle" });
      expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
    });

    it("shows a countdown when retryInSeconds is provided", () => {
      renderBanner({ retryInSeconds: 8 });
      expect(screen.getByText(/retrying in 8s/i)).toBeInTheDocument();
    });

    it("shows attempt count when reconnectAttempts > 0", () => {
      renderBanner({ reconnectAttempts: 2 });
      expect(screen.getByText(/attempt 2 of 5/i)).toBeInTheDocument();
    });

    it("shows 'Reconnect Now' button", () => {
      renderBanner({ reconnectStatus: "idle" });
      expect(screen.getByRole("button", { name: /reconnect now/i })).toBeInTheDocument();
    });

    it("calls onManualReconnect when 'Reconnect Now' is clicked", () => {
      const onManualReconnect = jest.fn();
      renderBanner({ onManualReconnect });
      fireEvent.click(screen.getByRole("button", { name: /reconnect now/i }));
      expect(onManualReconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("connecting state", () => {
    it("shows 'Reconnecting…' message", () => {
      renderBanner({ reconnectStatus: "connecting" });
      expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
    });

    it("shows attempt count while connecting", () => {
      renderBanner({ reconnectStatus: "connecting", reconnectAttempts: 3 });
      expect(screen.getByText(/attempt 3 of 5/i)).toBeInTheDocument();
    });

    it("disables the reconnect button while connecting", () => {
      renderBanner({ reconnectStatus: "connecting" });
      expect(screen.getByRole("button", { name: /reconnect now/i })).toBeDisabled();
    });

    it("shows 'Connecting…' label on the button while connecting", () => {
      renderBanner({ reconnectStatus: "connecting" });
      expect(screen.getByRole("button", { name: /reconnect now/i })).toHaveTextContent("Connecting…");
    });
  });

  describe("failed state", () => {
    it("shows failure message when reconnectStatus is 'failed'", () => {
      renderBanner({ reconnectStatus: "failed" });
      expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
    });

    it("shows failure message when max attempts reached", () => {
      renderBanner({ reconnectAttempts: 5, maxReconnectAttempts: 5 });
      expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
    });

    it("shows 'Reload page' button instead of 'Reconnect Now'", () => {
      renderBanner({ reconnectStatus: "failed" });
      expect(screen.queryByRole("button", { name: /reconnect now/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
    });

    it("calls window.location.reload when 'Reload page' is clicked", () => {
      renderBanner({ reconnectStatus: "failed" });
      fireEvent.click(screen.getByRole("button", { name: /reload page/i }));
      expect(mockReload).toHaveBeenCalledTimes(1);
    });
  });

  describe("dismiss button", () => {
    it("renders the dismiss button", () => {
      renderBanner();
      expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
    });

    it("is accessible with an aria-label", () => {
      renderBanner();
      expect(screen.getByRole("button", { name: /dismiss connection warning/i })).toBeInTheDocument();
    });
  });
});
