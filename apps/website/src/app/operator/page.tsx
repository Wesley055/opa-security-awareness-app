import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { hasOperatorSession } from '@/lib/operator-session';

/**
 * STUB. Replaced by the real shell in 14A-4 and the queue in 14A-6.
 *
 * It exists so 14A-1 is testable end to end - a login that redirects to a
 * 404 proves nothing about whether the session was established.
 *
 * The session check is server-side here rather than in middleware. That is
 * deliberate for now: middleware would need the Next 16 middleware -> proxy
 * migration, and a server component redirect is the more robust guarantee
 * anyway because it cannot be bypassed by a route the matcher missed.
 */

export const metadata: Metadata = {
  title: 'Command Center',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function OperatorHomePage() {
  if (!(await hasOperatorSession())) {
    redirect('/operator/login');
  }

  return (
    <div className="px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-protection">
        Command Center
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold text-ink">
        Signed in
      </h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        The session cookies are set. Facility context arrives in 14A-5 and the
        incident queue in 14A-6.
      </p>

      <form action="/api/operator/logout" method="post" className="mt-8">
        <button
          type="submit"
          className="rounded-md border border-line bg-panel px-4 py-2 text-sm text-ink"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}