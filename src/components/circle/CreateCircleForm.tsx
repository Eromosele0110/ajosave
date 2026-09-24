"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCircleSchema, type CreateCircleInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./CreateCircleForm.module.css";

export function CreateCircleForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateCircleInput>({
    resolver: zodResolver(createCircleSchema),
    defaultValues: { cycleFrequency: "monthly" },
  });

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
      router.push(`/circles/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Create a new savings circle"
    >
      <h2 className={styles.title}>Create a Circle</h2>

      <Input
        label="Circle Name"
        placeholder="e.g. Lagos Girls Monthly Ajo"
        error={errors.name?.message}
        required
        {...register("name")}
      />

      <Input
        label="Contribution Amount (₦)"
        type="number"
        placeholder="10000"
        error={errors.contributionNgn?.message}
        required
        hint="Minimum contribution amount in Nigerian Naira"
        {...register("contributionNgn", { valueAsNumber: true })}
      />

      <Input
        label="Number of Members"
        type="number"
        placeholder="5"
        min={2}
        max={20}
        error={errors.maxMembers?.message}
        required
        hint="Between 2 and 20 members"
        {...register("maxMembers", { valueAsNumber: true })}
      />

      <div className="input-group">
        <label className="input-label" htmlFor="cycleFrequency">
          Cycle Frequency
          <span aria-hidden="true" style={{ color: "var(--color-error)", marginLeft: "0.25em" }}>
            *
          </span>
        </label>
        <select
          id="cycleFrequency"
          className="input"
          aria-required="true"
          {...register("cycleFrequency")}
        >
          <option value="weekly">Weekly</option>
          <option value="biweekly">Bi-weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        {errors.cycleFrequency?.message && (
          <span className="input-error-msg" role="alert" aria-live="polite">
            {errors.cycleFrequency.message}
          </span>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert" aria-live="assertive">
          {error}
        </p>
      )}

      <Button type="submit" fullWidth loading={loading}>
        Create Circle
      </Button>
    </form>
  );
}
