"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(body?: { email: string; password: string }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/super-admin/" + (body ? "login" : "refresh"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const data = await response.json();
        setError(
          response.status === 401 && body
            ? "Invalid email or password."
            : (data.error ?? "Sign-in is unavailable."),
        );
      } else {
        router.replace("/super-admin");
        router.refresh();
      }
    } catch {
      setError("Sign-in is temporarily unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void submit({
            email: String(form.get("email")),
            password: String(form.get("password")),
          });
        }}
      >
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </label>
        {error && (
          <div role="alert" className="sa-notice">
            {error}
          </div>
        )}
        <button disabled={busy} type="submit">
          {busy ? "Checking access…" : "Sign in"}
        </button>
      </form>
      <p className="sa-muted">
        If your access session expired, you can restore your existing session.
      </p>
      <button
        className="sa-secondary"
        disabled={busy}
        onClick={() => void submit()}
      >
        Restore session
      </button>
    </>
  );
}
