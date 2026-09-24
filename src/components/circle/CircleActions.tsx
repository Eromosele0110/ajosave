"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DestructiveConfirmModal } from "@/components/ui/DestructiveConfirmModal";

interface Props {
  circleId: string;
  isCreator: boolean;
  isMember: boolean;
  status: string;
}

export function CircleActions({ circleId, isCreator, isMember, status }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<"cancel" | "leave" | "pause" | "resume" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  const handleCopyInvite = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/circles/${circleId}/invite`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      await navigator.clipboard.writeText(json.data.inviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate invite link");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/circles/${circleId}/cancel`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel circle");
    } finally {
      setLoading(false);
      setModal(null);
    }
  };

  const handleLeave = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/circles/${circleId}/leave`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      router.push("/circles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave circle");
    } finally {
      setLoading(false);
      setModal(null);
    }
  };

  const handlePause = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/circles/${circleId}/pause`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause circle");
    } finally {
      setLoading(false);
      setModal(null);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/circles/${circleId}/resume`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume circle");
    } finally {
      setLoading(false);
      setModal(null);
    }
  };

  const canCancel = isCreator && (status === "open" || status === "active" || status === "paused");
  const canLeave = isMember && !isCreator && status === "open";
  const canPause = isCreator && status === "active";
  const canResume = isCreator && status === "paused";

  if (!canCancel && !canLeave && !canPause && !canResume) return null;

  return (
    <>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
        {isCreator && status === "open" && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyInvite}
            disabled={loading}
          >
            {inviteCopied ? "Link Copied!" : "Copy Invite Link"}
          </Button>
        )}
        {canLeave && (
          <Button variant="ghost" size="sm" onClick={() => setModal("leave")}>
            Leave Circle
          </Button>
        )}
        {canPause && (
          <Button variant="ghost" size="sm" onClick={() => setModal("pause")}>
            Pause Circle
          </Button>
        )}
        {canResume && (
          <Button variant="primary" size="sm" onClick={() => setModal("resume")}>
            Resume Circle
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" size="sm" onClick={() => setModal("cancel")}>
            Cancel Circle
          </Button>
        )}
      </div>

      {error && <p style={{ fontSize: "var(--text-xs)", color: "var(--color-error)" }}>{error}</p>}

      <DestructiveConfirmModal
        open={modal === "cancel"}
        type="danger"
        title="Cancel Circle"
        message="Are you sure you want to cancel this circle? This action cannot be undone."
        consequences={[
          "All members will be immediately notified of the cancellation.",
          "Any pending contributions will need to be refunded manually.",
          "The circle and its payout schedule will be permanently removed.",
          "This cannot be reversed — a new circle must be created if needed.",
        ]}
        confirmPhrase="CANCEL"
        delay={3}
        confirmLabel="Yes, Cancel Circle"
        loading={loading}
        onConfirm={handleCancel}
        onCancel={() => setModal(null)}
      />

      <ConfirmModal
        open={modal === "leave"}
        title="Leave Circle"
        message="Are you sure you want to leave this circle? You will lose your position in the payout order."
        confirmLabel="Yes, Leave Circle"
        loading={loading}
        onConfirm={handleLeave}
        onCancel={() => setModal(null)}
      />

      <ConfirmModal
        open={modal === "pause"}
        title="Pause Circle"
        message="Are you sure you want to pause this circle? Future payouts will be temporarily suspended and members will be notified."
        confirmLabel="Yes, Pause Circle"
        loading={loading}
        onConfirm={handlePause}
        onCancel={() => setModal(null)}
      />

      <ConfirmModal
        open={modal === "resume"}
        title="Resume Circle"
        message="Are you sure you want to resume this circle? Normal schedule and payouts will be restored."
        confirmLabel="Yes, Resume Circle"
        loading={loading}
        onConfirm={handleResume}
        onCancel={() => setModal(null)}
      />
    </>
  );
}
