/**
 * Tests for useFormPersistence hook.
 *
 * We test the persistence contract rather than internal implementation details:
 *   1. Saved values are restored on re-mount.
 *   2. clearPersistedForm removes the entry from sessionStorage.
 *   3. Corrupted storage data is handled gracefully.
 */

import { renderHook, act } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useFormPersistence } from "../useFormPersistence";

// Minimal schema type used in tests.
interface TestForm {
  name: string;
  amount: number;
}

// Provide a real in-memory sessionStorage shim so we can assert on its state.
const sessionStorageData: Record<string, string> = {};
const sessionStorageMock: Storage = {
  getItem: (key) => sessionStorageData[key] ?? null,
  setItem: (key, value) => {
    sessionStorageData[key] = value;
  },
  removeItem: (key) => {
    delete sessionStorageData[key];
  },
  clear: () => {
    Object.keys(sessionStorageData).forEach((k) => delete sessionStorageData[k]);
  },
  get length() {
    return Object.keys(sessionStorageData).length;
  },
  key: (index) => Object.keys(sessionStorageData)[index] ?? null,
};

Object.defineProperty(window, "sessionStorage", {
  value: sessionStorageMock,
  writable: true,
});

const STORAGE_KEY = "test-form";
const FULL_STORAGE_KEY = `ajosave:form:v1:${STORAGE_KEY}`;

describe("useFormPersistence", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
  });

  it("restores previously saved values on mount", () => {
    // Pre-populate sessionStorage with saved draft.
    sessionStorageMock.setItem(
      FULL_STORAGE_KEY,
      JSON.stringify({ name: "Saved Name", amount: 5000 }),
    );

    const { result } = renderHook(() => {
      const form = useForm<TestForm>({ defaultValues: { name: "", amount: 0 } });
      useFormPersistence(form, STORAGE_KEY);
      return form;
    });

    // Values are restored via form.reset; getValues reflects the saved draft.
    expect(result.current.getValues("name")).toBe("Saved Name");
    expect(result.current.getValues("amount")).toBe(5000);
  });

  it("clears persisted data when clearPersistedForm is called", async () => {
    const { result } = renderHook(() => {
      const form = useForm<TestForm>({ defaultValues: { name: "", amount: 0 } });
      const persistence = useFormPersistence(form, STORAGE_KEY);
      return { form, ...persistence };
    });

    // Simulate a watch tick by triggering a field change.
    act(() => {
      result.current.form.setValue("name", "My Circle");
    });

    // Data should be persisted.
    expect(sessionStorageMock.getItem(FULL_STORAGE_KEY)).not.toBeNull();

    // Clear after successful submit.
    act(() => {
      result.current.clearPersistedForm();
    });

    expect(sessionStorageMock.getItem(FULL_STORAGE_KEY)).toBeNull();
  });

  it("handles corrupted sessionStorage data gracefully", () => {
    sessionStorageMock.setItem(FULL_STORAGE_KEY, "not-valid-json{{{{");

    // Should not throw.
    expect(() => {
      renderHook(() => {
        const form = useForm<TestForm>({ defaultValues: { name: "", amount: 0 } });
        useFormPersistence(form, STORAGE_KEY);
        return form;
      });
    }).not.toThrow();

    // Corrupted entry should be removed.
    expect(sessionStorageMock.getItem(FULL_STORAGE_KEY)).toBeNull();
  });
});
