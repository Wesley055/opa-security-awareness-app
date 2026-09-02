import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Reset password | OPA Viewer',
  robots: { index: false, follow: false, nocache: true },
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-protection">OPA Viewer</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">Reset password</h1>
        <p className="mt-2 text-sm text-muted">Enter your OPA account email. If the account is eligible, OPA will send password reset instructions.</p>
        <div className="mt-8"><ForgotPasswordForm /></div>
        <Link href="/operator/login" className="mt-6 inline-block text-sm font-medium text-protection hover:underline">Back to facility sign in</Link>
      </div>
    </div>
  );
}