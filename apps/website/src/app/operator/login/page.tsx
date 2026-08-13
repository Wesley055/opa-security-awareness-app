import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { hasOperatorSession } from '@/lib/operator-session';
import { LoginForm } from './login-form';

/**
 * Operator sign-in.
 *
 * Server-rendered so nothing about the API reaches client code. The form
 * itself is a client component because it needs state; it posts to the
 * same-origin bridge and never sees a token.
 */

export const metadata: Metadata = {
  title: 'Operator sign in',
  // An operator console must not be indexed. It is not secret - the login
  // page reveals nothing - but there is no reason for it in search results.
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function OperatorLoginPage() {
  // A cookie present only means a session can be ATTEMPTED. The console
  // itself will find out from the API whether it is still valid.
  if (await hasOperatorSession()) {
    redirect('/operator');
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-protection">
          Command Center
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">
          Operator sign in
        </h1>
        <p className="mt-2 text-sm text-muted">
          For facility operators. Residents use the OPA app.
        </p>

        <div className="mt-8">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}