import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: 'Set new password | OPA',
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-protection">OPA</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">Set a new password</h1>
        <p className="mt-2 text-sm text-muted">Use the secure reset link from your email, or enter the reset token manually.</p>
        <div className="mt-8"><ResetPasswordForm initialToken={token ?? ''} /></div>
        <Link href="/operator/login" className="mt-6 inline-block text-sm font-medium text-protection hover:underline">Back to facility sign in</Link>
      </div>
    </div>
  );
}