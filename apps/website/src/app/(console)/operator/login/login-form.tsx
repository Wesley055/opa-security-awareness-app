"use client";
import { PasswordInput } from "@/components/auth/password-input";

import { authRequest } from "@/lib/auth-request";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await authRequest("/api/operator/login", { email, password });
      setPassword("");
      router.replace("/operator");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Sign-in result is unknown. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-xs font-medium uppercase tracking-wide text-muted"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-ink outline-none focus:border-protection disabled:opacity-60"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-xs font-medium uppercase tracking-wide text-muted"
        >
          Password
        </label>
        <PasswordInput
          aria-label="Password"
          id="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-ink outline-none focus:border-protection disabled:opacity-60"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink"
        >
          {error}
        </p>
      ) : null}

      <div className="text-right">
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-protection hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-protection px-4 py-2 font-medium text-base transition disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
