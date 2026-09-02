'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = { initialToken: string };

export function ResetPasswordForm({ initialToken }: Props) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedToken = token.trim();
    if (normalizedToken.length < 32) { setError('Enter the complete password reset token from your OPA email.'); return; }
    if (password.length < 12) { setError('Password must be at least 12 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setPending(true);

    try {
      const response = await fetch('/api/operator/password-reset/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: normalizedToken, password }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        setError(result.error ?? 'Unable to reset your password.');
        return;
      }
      setToken(''); setPassword(''); setConfirmPassword('');
      router.replace('/operator/login?reason=password-reset');
      router.refresh();
    } catch {
      setError('Password reset is unavailable. Check your connection.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><label htmlFor="reset-token" className="block text-xs font-medium uppercase tracking-wide text-muted">Reset token</label><input id="reset-token" name="token" type="text" autoComplete="one-time-code" required value={token} onChange={(event) => setToken(event.target.value)} disabled={pending} className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-ink outline-none focus:border-protection disabled:opacity-60" /></div>
      <div><label htmlFor="new-password" className="block text-xs font-medium uppercase tracking-wide text-muted">New password</label><input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-ink outline-none focus:border-protection disabled:opacity-60" /></div>
      <div><label htmlFor="confirm-password" className="block text-xs font-medium uppercase tracking-wide text-muted">Confirm password</label><input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={pending} className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-ink outline-none focus:border-protection disabled:opacity-60" /></div>
      {error ? <p role="alert" className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink">{error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded-md bg-protection px-4 py-2 font-medium text-base transition disabled:opacity-60">{pending ? 'Resetting...' : 'Reset password'}</button>
    </form>
  );
}