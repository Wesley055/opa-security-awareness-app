import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionState } from '@/lib/operator-session';
import { fetchIncidentDetail } from '@/lib/operator-incident';
import {
  fetchIncidentTimeline,
  fetchTimelineVerification,
} from '@/lib/operator-timeline';
import { IncidentDetailView } from './incident-detail';

/**
 * One incident. 14A-7.
 *
 * IT GUARDS ITSELF. (protected)/layout.tsx deliberately does not - a layout
 * guard only covers what it happens to wrap, and a route added outside it
 * would be silently unprotected. Every protected page keeps its own check.
 *
 * FOUR FAILURE STATES, EACH SAYING SOMETHING DIFFERENT. A 403 is not a 404
 * and neither is an outage. Collapsing them would tell an operator that an
 * emergency does not exist when it does, or that they lack access when the
 * API was merely unreachable.
 */

export const metadata: Metadata = {
  title: 'Incident',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="px-6 py-8">
      <Link
        href="/operator"
        className="font-mono text-xs uppercase tracking-widest text-protection"
      >
        &larr; Active incidents
      </Link>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const state = await getSessionState();

  if (state === 'refreshable') {
    redirect('/api/operator/refresh');
  }

  if (state === 'none') {
    redirect('/operator/login');
  }

  const { incidentId } = await params;
  const result = await fetchIncidentDetail(incidentId);

  // Fetched alongside the detail so a deep link to a resolved
  // incident arrives complete, rather than showing an empty
  // timeline that fills in after hydration. Neither failing
  // blocks the page: the timeline renders empty and integrity
  // reads UNKNOWN, which is honest.
  const [timeline, verified] = await Promise.all([
    fetchIncidentTimeline(incidentId),
    fetchTimelineVerification(incidentId),
  ]);

  if (result.state === 'REJECTED') {
    redirect('/api/operator/refresh');
  }

  if (result.state === 'FORBIDDEN') {
    return (
      <Frame>
        <h1 className="font-display text-2xl font-bold text-ink">
          Access denied
        </h1>
        <p className="mt-3 max-w-prose text-sm text-ink">{result.message}</p>
        <p className="mt-2 max-w-prose text-sm text-muted">
          Incidents are visible only to the facility they were routed to when
          they were raised.
        </p>
      </Frame>
    );
  }

  if (result.state === 'NOT_FOUND') {
    return (
      <Frame>
        <h1 className="font-display text-2xl font-bold text-ink">
          Incident not found
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted">
          No incident with that reference exists.
        </p>
      </Frame>
    );
  }

  if (result.state === 'UNAVAILABLE') {
    return (
      <Frame>
        <h1 className="font-display text-2xl font-bold text-ink">Incident</h1>
        <p className="mt-3 max-w-prose text-sm text-ink">
          This incident is temporarily unavailable. This page does not know
          its current state. Reload in a moment.
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <IncidentDetailView
        /*
         * KEYED BY INCIDENT ID, AND THIS IS LOAD-BEARING. Navigating from
         * one incident to another keeps the same route pattern, so React
         * reconciles this as the same element and does NOT remount it -
         * useState would keep the previous incident and the poll would keep
         * calling the previous id. An operator clicking one emergency would
         * be shown another. Found exactly that way.
         */
        key={result.incident.id}
        initialIncident={result.incident}
        initialServerTime={result.serverTime}
        initialTimeline={timeline.state === 'READY' ? timeline.events : []}
        initialVerification={
          verified.state === 'READY' ? verified.verification : null
        }
      />
    </Frame>
  );
}