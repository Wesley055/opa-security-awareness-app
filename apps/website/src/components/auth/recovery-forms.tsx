"use client";
import { useRef, useState, type FormEvent } from "react";
import { PasswordInput } from "./password-input";
import { authRequest } from "@/lib/auth-request";
const inputClass =
  "mt-1 block w-full rounded-md border border-line bg-panel px-3 py-2 text-ink disabled:opacity-60";
const actionClass =
  "rounded-md bg-protection px-4 py-2 font-medium text-black disabled:opacity-60";
export function SignInDestinations() {
  return (
    <nav aria-label="Return to your sign-in">
      <a href="/super-admin/login">Super Admin sign in</a>
      {" · "}
      <a href="/institutional">Technical Support / Facility Admin sign in</a>
      {" · "}
      <a href="/operator/login">Operator sign in</a>
      <p>Residents and Users: return to the OPA mobile app to sign in.</p>
    </nav>
  );
}
export function ForgotPasswordForm() {
  const [email, setEmail] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await authRequest("/api/auth/password-reset/request", {
        email: email.trim().toLowerCase(),
      });
      setMessage(
        "If an eligible OPA local-password account exists, recovery instructions will be sent. Check your email; delivery may take a few minutes.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recovery unavailable. Retry.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        Email
        <input
          className={inputClass}
          name="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </label>
      <p>
        This resets a local password. Restore session renews an existing
        session; it does not recover a forgotten password. For SSO-only
        accounts, use your institution&apos;s identity-provider recovery.
      </p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <button className={actionClass} disabled={busy}>
        {busy
          ? "Requesting recovery…"
          : message
            ? "Resend recovery email"
            : "Send recovery email"}
      </button>
      <p>
        <a href="/reset-password">I have a reset token</a>
      </p>
      <SignInDestinations />
    </form>
  );
}
export function ResetPasswordForm({
  initialToken = "",
}: {
  initialToken?: string;
}) {
  const [token, setToken] = useState(initialToken),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    setError("");
    if (password !== confirm) {
      setError("Passwords must match.");
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await authRequest("/api/auth/password-reset/confirm", {
        token: token.trim(),
        password,
      });
      setPassword("");
      setConfirm("");
      setToken("");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset unavailable. Retry.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (done)
    return (
      <section>
        <p role="status">
          Your password has been reset. Previous credentials and sessions are
          invalid. Sign in with your new password; your role and institutional
          authority have not changed.
        </p>
        <SignInDestinations />
      </section>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        Reset token
        <input
          className={inputClass}
          name="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          required
          minLength={32}
          disabled={busy}
        />
      </label>
      <label className="block">
        New password
        <PasswordInput
          className={inputClass}
          aria-label="New password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={12}
          disabled={busy}
        />
      </label>
      <label className="block">
        Confirm password
        <PasswordInput
          className={inputClass}
          aria-label="Confirm password"
          name="confirmPassword"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          minLength={12}
          disabled={busy}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className={actionClass} disabled={busy}>
        {busy ? "Resetting password…" : "Reset password"}
      </button>
      <p>
        <a href="/forgot-password">Request a new recovery email</a>
      </p>
    </form>
  );
}
