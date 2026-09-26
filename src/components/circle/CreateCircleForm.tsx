"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCircleSchema, type CreateCircleInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormPersistence } from "@/hooks/useFormPersistence";
import styles from "./CreateCircleForm.module.css";

const FORM_STORAGE_KEY = "create-circle";

export function CreateCircleForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CreateCircleInput>({
    resolver: zodResolver(createCircleSchema),
    defaultValues: { cycleFrequency: "monthly" },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  // Persist form values to sessionStorage so they survive navigation / refresh.
  const { clearPersistedForm } = useFormPersistence(form, FORM_STORAGE_KEY);

  const onSubmit = async (data: CreateCircleInput) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/circles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      // Clear the draft only after a successful submission.
      clearPersistedForm();
      router.push(`/circles/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2 className={styles.title}>Create a Circle</h2>

      <Input
        label="Circle Name"
        placeholder="e.g. Lagos Girls Monthly Ajo"
        error={errors.name?.message}
        {...register("name")}
      />

      <Input
        label="Contribution Amount (₦)"
        type="number"
        placeholder="10000"
        error={errors.contributionNgn?.message}
        {...register("contributionNgn", { valueAsNumber: true })}
      />

      <Input
        label="Number of Members"
        type="number"
        placeholder="5"
        min={2}
        max={20}
        error={errors.maxMembers?.message}
        {...register("maxMembers", { valueAsNumber: true })}
      />

      <div className="input-group">
        <label className="input-label" htmlFor="cycleFrequency">
          Cycle Frequency
        </label>
        <select id="cycleFrequency" className="input" {...register("cycleFrequency")}>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Bi-weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <Button type="submit" fullWidth loading={loading}>
        Create Circle
      </Button>
    </form>
  );
}
