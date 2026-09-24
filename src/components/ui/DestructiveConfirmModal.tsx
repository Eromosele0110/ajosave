"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./DestructiveConfirmModal.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModalType = "danger" | "warning" | "info";

interface Props {
  open: boolean;
  type?: ModalType;
  title: string;
  message: string;
  /** Optional bulleted list of consequences shown above the phrase input */
  consequences?: string[];
  /** If set, the user must type this exact phrase before the confirm button enables */
  confirmPhrase?: string;
  /** Seconds the confirm button stays disabled after opening (default: 0) */
  delay?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FOCUSABLE =
  'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const TYPE_ICONS: Record<ModalType, string> = {
  danger:  "⚠",
  warning: "⚠",
  info:    "ℹ",
};

const TYPE_ICON_LABELS: Record<ModalType, string> = {
  danger:  "Danger",
  warning: "Warning",
  info:    "Information",
};

const CONFIRM_BUTTON_CLASS: Record<ModalType, string> = {
  danger:  styles.confirmDanger,
  warning: styles.confirmWarning,
  info:    styles.confirmInfo,
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * An enhanced confirmation modal for destructive or high-impact actions.
 *
 * Features:
 * - Three severity variants: `danger` | `warning` | `info`
 * - Bulleted `consequences` list
 * - Optional `confirmPhrase` — user must type the exact phrase to unlock confirm
 * - Optional `delay` (seconds) — confirm button is disabled for N seconds after open
 * - Full keyboard trap and focus restoration (matches ConfirmModal patterns)
 */
export function DestructiveConfirmModal({
  open,
  type = "danger",
  title,
  message,
  consequences,
  confirmPhrase,
  delay = 0,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef  = useRef<HTMLButtonElement>(null);
  const modalRef   = useRef<HTMLDivElement>(null);
  const phraseRef  = useRef<HTMLInputElement>(null);

  const [phraseValue, setPhraseValue]     = useState("");
  const [secondsLeft, setSecondsLeft]     = useState(0);

  // Reset state when modal opens
  useEffect(() => {
    if (!open) return;
    setPhraseValue("");
    setSecondsLeft(delay > 0 ? delay : 0);
  }, [open, delay]);

  // Countdown timer
  useEffect(() => {
    if (!open || secondsLeft <= 0) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearInterval(id); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [open, secondsLeft]);

  // Focus management: focus phrase input if present, else cancel button
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (confirmPhrase) {
      phraseRef.current?.focus();
    } else {
      cancelRef.current?.focus();
    }
    return () => { previouslyFocused?.focus(); };
  }, [open, confirmPhrase]);

  // Keyboard trap + ESC handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCancel(); return; }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    },
    [onCancel]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const phraseMatches  = !confirmPhrase || phraseValue === confirmPhrase;
  const delayPending   = secondsLeft > 0;
  const confirmBlocked = !phraseMatches || delayPending;

  const dialogId      = "destructive-confirm-title";
  const descriptionId = "destructive-confirm-message";

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogId}
      aria-describedby={descriptionId}
    >
      <div
        ref={modalRef}
        className={`${styles.modal} ${styles[type]}`}
      >
        {/* ── Header ── */}
        <div className={styles.header}>
          <span
            className={`${styles.icon} ${styles[type]}`}
            role="img"
            aria-label={TYPE_ICON_LABELS[type]}
          >
            {TYPE_ICONS[type]}
          </span>
          <h2 id={dialogId} className={styles.title}>
            {title}
          </h2>
        </div>

        {/* ── Message ── */}
        <p id={descriptionId} className={styles.message}>
          {message}
        </p>

        {/* ── Consequences list ── */}
        {consequences && consequences.length > 0 && (
          <ul
            className={`${styles.consequences} ${styles[type]}`}
            aria-label="Consequences of this action"
          >
            {consequences.map((item, i) => (
              <li key={i}>
                <span className={`${styles.bullet} ${styles[type]}`} aria-hidden="true">
                  ✕
                </span>
                {item}
              </li>
            ))}
          </ul>
        )}

        {/* ── Confirm-phrase input ── */}
        {confirmPhrase && (
          <div className={styles.phraseSection}>
            <label htmlFor="confirm-phrase-input" className={styles.phraseLabel}>
              Type{" "}
              <span className={styles.phraseCode}>{confirmPhrase}</span>{" "}
              to confirm:
            </label>
            <input
              ref={phraseRef}
              id="confirm-phrase-input"
              type="text"
              value={phraseValue}
              onChange={(e) => setPhraseValue(e.target.value)}
              className={`${styles.phraseInput} ${styles[type]}`}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${confirmPhrase} to confirm`}
              aria-invalid={phraseValue.length > 0 && !phraseMatches}
              aria-describedby={
                phraseValue.length > 0 && !phraseMatches
                  ? "phrase-error"
                  : undefined
              }
            />
            {phraseValue.length > 0 && !phraseMatches && (
              <span
                id="phrase-error"
                role="alert"
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-error)",
                  marginTop: "var(--space-1)",
                  display: "block",
                }}
              >
                Text does not match — type <strong>{confirmPhrase}</strong> exactly.
              </span>
            )}
          </div>
        )}

        {/* ── Delay hint ── */}
        {delayPending && (
          <p className={styles.delayHint} aria-live="polite" aria-atomic="true">
            Please wait {secondsLeft}s…
          </p>
        )}

        {/* ── Action buttons ── */}
        <div className={styles.actions}>
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={onCancel}
            disabled={loading}
            aria-label={cancelLabel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            loading={loading}
            disabled={confirmBlocked || loading}
            className={CONFIRM_BUTTON_CLASS[type]}
            aria-label={
              delayPending
                ? `${confirmLabel} (available in ${secondsLeft}s)`
                : confirmLabel
            }
            aria-disabled={confirmBlocked || loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
