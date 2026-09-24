"use client";

// Prevent static prerender — next-auth requires NEXTAUTH_URL at runtime
export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import styles from "./page.module.css";

type Step = "phone" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await signIn("credentials", { phone, otp, redirect: false });
      if (result?.error) throw new Error("Invalid OTP. Please try again.");
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={`container container--sm ${styles.inner}`}>
        <div className="card">
          <h1 className={styles.title} id="login-heading">
            {step === "phone" ? "Sign in to STELLAR" : "Enter your OTP"}
          </h1>
          <p className={styles.subtitle} id="login-subtitle">
            {step === "phone"
              ? "Enter your phone number to receive a one-time code."
              : `We sent a 6-digit code to ${phone}.`}
          </p>

          {step === "phone" ? (
            <form
              onSubmit={handleSendOtp}
              className={styles.form}
              noValidate
              aria-labelledby="login-heading"
              aria-describedby="login-subtitle"
            >
              <Input
                label="Phone Number"
                type="tel"
                placeholder="+2348012345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
                autoFocus
              />
              {error && (
                <p className={styles.error} role="alert" aria-live="assertive">
                  {error}
                </p>
              )}
              <Button type="submit" fullWidth loading={loading}>
                Send Code
              </Button>
            </form>
          ) : (
            <form
              onSubmit={handleVerifyOtp}
              className={styles.form}
              noValidate
              aria-labelledby="login-heading"
              aria-describedby="login-subtitle"
            >
              <Input
                label="6-Digit Code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                autoComplete="one-time-code"
                autoFocus
                hint="Enter the 6-digit code sent to your phone"
              />
              {error && (
                <p className={styles.error} role="alert" aria-live="assertive">
                  {error}
                </p>
              )}
              <Button type="submit" fullWidth loading={loading}>
                Verify &amp; Sign In
              </Button>
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--full"
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
              >
                Change number
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
