import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionState } from '@/lib/operator-session';
import { getOperatorContext } from '@/lib/operator-context';
import { fetchOperatorQueue } from '@/lib/operator-queue';
import { IncidentQueue } from './incident-queue';

/**
 * The operator's live queue. 14A-6.
 *
 * The session check is server-side here rather than in middleware. That is
 * deliberate: middleware would need the Next 16 middleware -> proxy
 * migration, and a server component redirect cannot be bypassed by a route
 * the matcher missed. The same argument is why (protected)/layout.tsx does
 * NOT hold this check.
 *
 * THE FIRST PAGE IS FETCHED ON THE SERVER so the operator sees real
 * emergencies in the first paint rather than an empty list that fills in.
 * The client component takes over polling from there.
 *
 * A FAILED INITIAL FETCH RENDERS THE QUEUE EMPTY BUT SAYS SO. It does not
 * render "no active incidents" - that would be a claim this page cannot
 * make when it could not reach the API.
 */

export const metadata: Metadata = {
  title: 'Active incidents',
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

  const context = await getOperatorContext();

  if (context.state === 'REJECTED') {
    redirect('/api/operator/refresh');
  }

  if (
    context.state === 'READY' &&
    context.context.role === 'FACILITY_ADMIN'
  ) {
    redirect('/operator/residents');
  }

  const queue = await fetchOperatorQueue();

  if (queue.state === 'REJECTED') {
    // The cookie was present but the token was refused. Rotation is the
    // recovery path, exactly as in the shell.
    redirect('/api/operator/refresh');
  }

  if (queue.state === 'FORBIDDEN') {
    return (
      <section className="px-6 py-8">
        <h1 className="font-display text-2xl font-bold text-ink">
          Active incidents
        </h1>
        <p className="mt-4 max-w-prose text-sm text-ink">{queue.message}</p>
      </section>
    );
  }

  if (queue.state === 'UNAVAILABLE') {
    return (
      <section className="px-6 py-8">
        <h1 className="font-display text-2xl font-bold text-ink">
          Active incidents
        </h1>
        <p className="mt-4 max-w-prose text-sm text-ink">
          The queue is temporarily unavailable. This page does not know
          whether there are active incidents right now. Reload in a moment.
        </p>
      </section>
    );
  }

  return (
    <IncidentQueue
      initialIncidents={queue.incidents}
      initialNextCursor={queue.nextCursor}
      initialHasMore={queue.hasMore}
      initialServerTime={queue.serverTime}
    />
  );
}
