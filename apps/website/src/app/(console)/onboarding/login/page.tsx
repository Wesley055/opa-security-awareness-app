"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function Login() {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signIn(body?: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/onboarding/" + (body ? "login" : "refresh"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      if (!response.ok)
        throw new Error((await response.json()).error ?? "Sign-in failed.");
      router.replace("/onboarding");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-in unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="sa-login">
      <section className="sa-card">
        <h1>OPA staff onboarding</h1>
        <p>
          Use your individual OPA account. An active facility assignment is
          required.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void signIn({
              email: form.get("email"),
              password: form.get("password"),
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
          <button disabled={busy}>Sign in</button>
        </form>
        <button
          className="sa-secondary"
          disabled={busy}
          onClick={() => void signIn()}
        >
          Restore session
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
