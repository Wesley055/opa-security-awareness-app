import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchOperatorMembership } from '@/lib/operator-membership';
import { getSessionState } from '@/lib/operator-session';
import { FacilityMembership } from './facility-membership';

export const metadata: Metadata = {
  title: 'Facility membership',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = 'force-dynamic';

/**
 * 14A-11 facility membership.
 *
 * THIS IS DELIBERATELY A SEPARATE ROUTE FROM /operator.
 *
 * /operator is the emergency queue and its first paint must never wait on
 * reference information. Membership has its own SSR request lifecycle here,
 * so a slow or unavailable roster cannot delay or redirect the live queue.
 */
export default async function OperatorMembersPage() {
  const state = await getSessionState();

  if (state === 'refreshable') {
    redirect('/api/operator/refresh');
  }

  if (state === 'none') {
    redirect('/operator/login');
  }

  const membership = await fetchOperatorMembership();

  if (membership.state === 'REJECTED') {
    redirect('/api/operator/refresh');
  }

  return <FacilityMembership result={membership} />;
}
