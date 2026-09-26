"use client";

import { useEffect, useState } from "react";

export default function OfflinePage() {
  const [isBack, setIsBack] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsBack(true);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: "1.25rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <span style={{ fontSize: "3rem" }} aria-hidden="true">
        📡
      </span>

      {isBack ? (
        <>
          <h1 style={{ fontSize: "1.75rem", fontWeight: "bold", color: "var(--color-text-primary)" }}>
            You&apos;re back online!
          </h1>
          <p style={{ color: "var(--color-text-secondary)", maxWidth: "400px" }}>
            Connection restored. Head back to pick up where you left off.
          </p>
          <a href="/" className="btn btn--primary">
            Go to home
          </a>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: "1.75rem", fontWeight: "bold", color: "var(--color-text-primary)" }}>
            You&apos;re offline
          </h1>
          <p style={{ color: "var(--color-text-secondary)", maxWidth: "400px" }}>
            No internet connection. Cached pages are still available — you can
            browse your circles and dashboard while offline. Changes will sync
            when you reconnect.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
            <a href="/circles" className="btn btn--primary">
              My Circles
            </a>
            <a href="/dashboard" className="btn btn--secondary">
              Dashboard
            </a>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-tertiary, #9ca3af)" }}>
            Waiting for connection to restore…
          </p>
        </>
      )}
    </div>
  );
}
