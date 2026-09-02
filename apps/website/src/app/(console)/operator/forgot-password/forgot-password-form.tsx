'use client';

import Link from 'next/link';
import { useState } from 'react';

const GENERIC_MESSAGE =
  'If an eligible OPA account exists for that email, password reset instructions have been sent.';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setPending(true);

    try {
      const response = await fetch('/api/operator/password-reset/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !result.ok) {
        setError(result.error ?? 'Unable to request a password reset right now.');
        return;
      }
      setMessage(result.message ?? GENERIC_MESSAGE);
    } catch {
      setError('Password reset is unavailable. Check your connection.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="reset-email" className="block text-xs font-medium uppercase tracking-wide text-muted">Email</label>
        <input id="reset-email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-ink outline-none focus:border-protection disabled:opacity-60" />
      </div>
      {message ? <p role="status" className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink">{message}</p> : null}
      {error ? <p role="alert" className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink">{error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded-md bg-protection px-4 py-2 font-medium text-base transition disabled:opacity-60">{pending ? 'Sending...' : 'Send reset instructions'}</button>
      <p className="text-sm text-muted">Already have a reset token? <Link href="/operator/reset-password" className="font-medium text-protection hover:underline">Set a new password</Link></p>
    </form>
  );
}