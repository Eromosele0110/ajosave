"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { DestructiveConfirmModal } from "@/components/ui/DestructiveConfirmModal";

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me", { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await signOut({ callbackUrl: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Delete Account
      </Button>
      {error && (
        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-error)",
            marginTop: "var(--space-2)",
          }}
        >
          {error}
        </p>
      )}
      <DestructiveConfirmModal
        open={open}
        type="danger"
        title="Delete Account"
        message="This will permanently delete your account and all associated data."
        consequences={[
          "Your profile and personal information will be erased.",
          "You will be removed from all circles you have joined.",
          "Your contribution history will be permanently lost.",
          "This action cannot be undone — you will need to create a new account.",
        ]}
        confirmPhrase="DELETE"
        delay={3}
        confirmLabel="Yes, Delete My Account"
        loading={loading}
        onConfirm={handleDelete}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
