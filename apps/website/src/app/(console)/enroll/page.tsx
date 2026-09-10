"use client";
import { useState } from "react";
export default function EnrollPage() {
  const [stage, setStage] = useState("VERIFY"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 24 }}>
      <h1>Accept your OPA invitation</h1>
      <p>
        Use the request ID and verification codes delivered to your email and
        phone.
      </p>
      {stage === "ACCEPTED" ? (
        <p role="status">
          Your membership is active.{" "}
          <a href="/operator/login">Sign in to the facility console</a>, or open
          OPA for resident access.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            const body = Object.fromEntries(new FormData(e.currentTarget));
            try {
              const response = await fetch("/api/enroll", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...body,
                  accept: body.accept === "on",
                  action: stage === "VERIFY" ? "verify" : "accept",
                }),
                cache: "no-store",
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error);
              setStage(result.status);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Enrollment unavailable.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} style={{ display: "grid", gap: 18 }}>
            {stage === "VERIFY" ? (
              <>
                <label>
                  Request ID
                  <input
                    name="requestId"
                    required
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <label>
                  Email verification code
                  <input
                    name="emailCode"
                    required
                    autoComplete="off"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <label>
                  Phone verification code
                  <input
                    name="phoneCode"
                    required
                    autoComplete="off"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <label>
                  Choose a password
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <label>
                  <input type="checkbox" name="accept" required /> I accept this
                  institutional membership.
                </label>
              </>
            ) : (
              <>
                <p>
                  Both proofs are verified. Sign in to your existing account to
                  accept this membership.
                </p>
                <label>
                  Email
                  <input
                    type="email"
                    name="email"
                    required
                    autoComplete="username"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <label>
                  Current password
                  <input
                    type="password"
                    name="password"
                    required
                    autoComplete="current-password"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
              </>
            )}
            <button>
              {busy
                ? "Processing…"
                : stage === "VERIFY"
                  ? "Verify invitation"
                  : "Sign in and accept membership"}
            </button>
          </fieldset>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
