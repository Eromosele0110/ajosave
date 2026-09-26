import { render, screen, fireEvent, act } from "@testing-library/react";
import { DestructiveConfirmModal } from "../DestructiveConfirmModal";

// CSS module mock is handled by Next.js jest transform via jest.config.ts

const noop = () => {};

describe("DestructiveConfirmModal", () => {
  describe("renders nothing when closed", () => {
    it("returns null when open=false", () => {
      const { container } = render(
        <DestructiveConfirmModal
          open={false}
          title="Test"
          message="Test message"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("basic rendering when open", () => {
    it("renders the title", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Cancel Circle"
          message="This is irreversible."
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByText("Cancel Circle")).toBeInTheDocument();
    });

    it("renders the message", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Cancel Circle"
          message="This is irreversible."
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByText("This is irreversible.")).toBeInTheDocument();
    });

    it("renders with role=dialog and aria-modal", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Cancel Circle"
          message="Irreversible"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("uses the title as aria-labelledby text", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Delete Account"
          message="Gone forever"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("dialog")).toHaveAttribute(
        "aria-labelledby",
        "destructive-confirm-title"
      );
      expect(screen.getByText("Delete Account")).toBeInTheDocument();
    });

    it("renders confirm and cancel buttons with default labels", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Confirm"
          message="Are you sure?"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    });

    it("renders custom confirmLabel and cancelLabel", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Cancel Circle"
          message="msg"
          confirmLabel="Yes, Cancel"
          cancelLabel="No, Keep It"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("button", { name: /yes, cancel/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /no, keep it/i })).toBeInTheDocument();
    });
  });

  describe("type variants", () => {
    it("renders the danger icon", () => {
      render(
        <DestructiveConfirmModal
          open
          type="danger"
          title="Danger"
          message="msg"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("img", { name: /danger/i })).toBeInTheDocument();
    });

    it("renders the warning icon", () => {
      render(
        <DestructiveConfirmModal
          open
          type="warning"
          title="Warning"
          message="msg"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("img", { name: /warning/i })).toBeInTheDocument();
    });

    it("renders the info icon", () => {
      render(
        <DestructiveConfirmModal
          open
          type="info"
          title="Info"
          message="msg"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("img", { name: /information/i })).toBeInTheDocument();
    });

    it("defaults to danger type when type prop is omitted", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Default type"
          message="msg"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("img", { name: /danger/i })).toBeInTheDocument();
    });
  });

  describe("consequences list", () => {
    it("renders consequences when provided", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Cancel"
          message="msg"
          consequences={["Members will be notified", "Cannot be undone"]}
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByText("Members will be notified")).toBeInTheDocument();
      expect(screen.getByText("Cannot be undone")).toBeInTheDocument();
    });

    it("does not render the consequences list when prop is absent", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Cancel"
          message="msg"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(
        screen.queryByLabelText(/consequences of this action/i)
      ).not.toBeInTheDocument();
    });

    it("does not render the consequences list when array is empty", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Cancel"
          message="msg"
          consequences={[]}
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(
        screen.queryByLabelText(/consequences of this action/i)
      ).not.toBeInTheDocument();
    });
  });

  describe("confirmPhrase", () => {
    it("renders the phrase input when confirmPhrase is set", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Delete"
          message="msg"
          confirmPhrase="DELETE"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByLabelText(/type DELETE to confirm/i)).toBeInTheDocument();
    });

    it("confirm button is disabled when phrase has not been typed", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Delete"
          message="msg"
          confirmPhrase="DELETE"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    });

    it("confirm button is disabled when phrase is partially typed", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Delete"
          message="msg"
          confirmPhrase="DELETE"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      fireEvent.change(screen.getByLabelText(/type DELETE to confirm/i), {
        target: { value: "DELET" },
      });
      expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    });

    it("confirm button is enabled when exact phrase is typed (no delay)", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Delete"
          message="msg"
          confirmPhrase="DELETE"
          delay={0}
          onConfirm={noop}
          onCancel={noop}
        />
      );
      fireEvent.change(screen.getByLabelText(/type DELETE to confirm/i), {
        target: { value: "DELETE" },
      });
      expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled();
    });

    it("shows an error hint when phrase doesn't match and is non-empty", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Delete"
          message="msg"
          confirmPhrase="DELETE"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      fireEvent.change(screen.getByLabelText(/type DELETE to confirm/i), {
        target: { value: "wrong" },
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("does not render phrase input when confirmPhrase is omitted", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Delete"
          message="msg"
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("delay prop", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("confirm button is disabled while countdown is active", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Test"
          message="msg"
          delay={3}
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    });

    it("shows countdown text while delay is pending", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Test"
          message="msg"
          delay={5}
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByText(/please wait/i)).toBeInTheDocument();
    });

    it("confirm button becomes enabled after delay expires (no phrase)", async () => {
      render(
        <DestructiveConfirmModal
          open
          title="Test"
          message="msg"
          delay={2}
          onConfirm={noop}
          onCancel={noop}
        />
      );
      expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();

      await act(async () => { jest.advanceTimersByTime(3000); });

      expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled();
    });
  });

  describe("loading state", () => {
    it("disables both buttons while loading", () => {
      render(
        <DestructiveConfirmModal
          open
          title="Test"
          message="msg"
          loading
          onConfirm={noop}
          onCancel={noop}
        />
      );
      const buttons = screen.getAllByRole("button");
      buttons.forEach((btn) => expect(btn).toBeDisabled());
    });
  });

  describe("callbacks", () => {
    it("calls onCancel when the Cancel button is clicked", () => {
      const onCancel = jest.fn();
      render(
        <DestructiveConfirmModal
          open
          title="Test"
          message="msg"
          onConfirm={noop}
          onCancel={onCancel}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onConfirm when confirm button is clicked (no phrase, no delay)", () => {
      const onConfirm = jest.fn();
      render(
        <DestructiveConfirmModal
          open
          title="Test"
          message="msg"
          delay={0}
          onConfirm={onConfirm}
          onCancel={noop}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when Escape key is pressed", () => {
      const onCancel = jest.fn();
      render(
        <DestructiveConfirmModal
          open
          title="Test"
          message="msg"
          onConfirm={noop}
          onCancel={onCancel}
        />
      );
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
