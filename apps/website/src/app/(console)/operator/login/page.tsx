import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionState } from '@/lib/operator-session';
import { LoginForm } from './login-form';

/**
 * Facility Viewer sign-in.
 *
 * Server-rendered so nothing about the API reaches client code. The form
 * itself is a client component because it needs state; it posts to the
 * same-origin bridge and never sees a token.
 *
 * 14A-3 added the notice and the rotation attempt. THE PRESENCE OF A reason
 * PARAMETER SUPPRESSES ROTATION, and that is not cosmetic - it is what
 * breaks the loop. Without it: refresh route hits an outage, redirects here,
 * this page sees a refresh cookie it did not clear, redirects back to the
 * refresh route, forever.
 *
 * The notice text comes from a fixed map. The parameter selects a message;
 * it is never rendered. It is also not a redirect target, so it adds no
 * open-redirect surface - but it IS forgeable, in that anyone can link an
 * Viewer user here and show them a session-ended notice. That is tolerable only
 * because the message is advisory and the page behind it is a login form.
 * Nothing that matters may ever be decided by this parameter.
 */

const NOTICES: Record<string, string> = {
  'session-ended': 'Your session ended. Sign in again.',
  unavailable:
    'Sign-in is temporarily unavailable. Please try again in a moment.',
};

export const metadata: Metadata = {
  title: 'Facility sign in | OPA Viewer',
  // The facility Viewer must not be indexed. It is not secret - the login
  // page reveals nothing - but there is no reason for it in search results.
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function OperatorLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const notice = raw ? (NOTICES[raw] ?? null) : null;

  // Only when we did not arrive here FROM the refresh route. See above.
  if (!notice) {
    // A cookie present only means a session can be ATTEMPTED. The Viewer
    // itself will find out from the API whether it is still valid.
    const state = await getSessionState();

    if (state === 'active') {
      redirect('/operator');
    }

    if (state === 'refreshable') {
      redirect('/api/operator/refresh');
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-protection">
          OPA Viewer
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">
          Facility sign in
        </h1>
        <p className="mt-2 text-sm text-muted">
          For facility administrators and operators. Residents use the OPA app.
        </p>

        {notice ? (
          <p
            role="status"
            className="mt-6 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink"
          >
            {notice}
          </p>
        ) : null}

        <div className="mt-8">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}