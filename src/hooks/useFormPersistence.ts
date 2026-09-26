"use client";

import { useEffect, useCallback } from "react";
import type { UseFormReturn, FieldValues } from "react-hook-form";

const STORAGE_VERSION = "v1";

/**
 * Persists react-hook-form state to sessionStorage so that validation errors
 * and entered values survive accidental navigation / page refresh.
 *
 * Values are keyed by `storageKey` and scoped to the current browser session
 * (sessionStorage) so they are not shared across tabs and are cleared when the
 * tab is closed – appropriate for sensitive financial form data.
 */
export function useFormPersistence<T extends FieldValues>(
  form: UseFormReturn<T>,
  storageKey: string,
) {
  const key = `ajosave:form:${STORAGE_VERSION}:${storageKey}`;

  // Restore persisted values on mount (runs once).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<T>;
      form.reset(saved as T, {
        keepErrors: false,
        keepDirty: false,
        keepDefaultValues: true,
      });
    } catch {
      // Corrupted data – clear and start fresh.
      sessionStorage.removeItem(key);
    }
    // We only want to run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Watch all field changes and persist to sessionStorage.
  useEffect(() => {
    const subscription = form.watch((values) => {
      try {
        sessionStorage.setItem(key, JSON.stringify(values));
      } catch {
        // Storage may be full or unavailable – silently fail.
      }
    });
    return () => subscription.unsubscribe();
  }, [form, key]);

  /** Call this after a successful submission to clear the persisted draft. */
  const clearPersistedForm = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  }, [key]);

  return { clearPersistedForm };
}
