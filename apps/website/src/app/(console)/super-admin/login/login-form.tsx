"use client";
import { PasswordInput } from "@/components/auth/password-input";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(body?: { email: string; password: string }) {
    setBusy(true);
    setError("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      await Promise.race([
        (async () => {
          const response = await fetch(
            "/api/super-admin/" + (body ? "login" : "refresh"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              ...(body ? { body: JSON.stringify(body) } : {}),
              cache: "no-store",
              signal: controller.signal,
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
            if (body) {
              try {
                localStorage.setItem(
                  "opa-super-admin-session",
                  crypto.randomUUID(),
                );
              } catch {}
            }
            router.replace("/super-admin");
            router.refresh();
          }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new Error(
                "Result unknown. Try signing in or restoring your session again.",
              ),
            );
          }, 15000);
        }),
      ]);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Sign-in result unknown. Try again.",
      );
    } finally {
      if (timer) clearTimeout(timer);
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
          <PasswordInput
            aria-label="Password"
            name="password"

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
      <p>
        <a href="/forgot-password">Forgot password / recover access</a>
      </p>
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
