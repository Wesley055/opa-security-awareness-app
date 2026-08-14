import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionState } from '@/lib/operator-session';

/**
 * STUB. Replaced by facility context in 14A-5 and the queue in 14A-6.
 *
 * It exists so 14A-1 is testable end to end - a login that redirects to a
 * 404 proves nothing about whether the session was established.
 *
 * The session check is server-side here rather than in middleware. That is
 * deliberate: middleware would need the Next 16 middleware -> proxy
 * migration, and a server component redirect is the more robust guarantee
 * anyway because it cannot be bypassed by a route the matcher missed. The
 * same argument is why (protected)/layout.tsx does NOT hold this check.
 *
 * 14A-3: the check is three-state. A server component CANNOT write cookies,
 * so this page cannot rotate - it sends the browser to the refresh route,
 * which owns every mutation of the session cookies, and comes back.
 *
 * 14A-4: sign out moved to the shell header. It is not repeated here.
 */

export const metadata: Metadata = {
  title: 'Overview',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function OperatorHomePage() {
  const state = await getSessionState();

  if (state === 'refreshable') {
    redirect('/api/operator/refresh');
  }

  if (state === 'none') {
    redirect('/operator/login');
  }

  return (
    <div className="px-6 py-16">
      <h1 className="font-display text-3xl font-bold text-ink">Signed in</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Facility context is live above. The incident queue arrives in 14A-6.
      </p>
    </div>
  );
}