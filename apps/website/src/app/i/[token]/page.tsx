import type { Metadata } from 'next';
import { fetchTracking } from '@/lib/tracking';
import { LiveTracking } from './live-tracking';

/**
 * Public incident tracking page.
 *
 * The token in the URL is the credential. This page is rendered server-side
 * and the token never reaches the browser's JavaScript, analytics, or error
 * reporting.
 *
 * Deliberately a SNAPSHOT, not live tracking: OPA does not yet store
 * continuous position or device telemetry. The wording must not imply
 * otherwise.
 */

export const metadata: Metadata = {
  title: 'Emergency alert',
  // A tracking link pasted into a public forum must not be indexed, and the
  // token must never appear in a page title or canonical URL.
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function TrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await fetchTracking(token);

  // The token stays server-side here. LiveTracking polls the SAME-ORIGIN
  // bridge at /api/tracking/<token>, so the OPA API hostname never reaches
  // client code and no cross-origin request carries the token.
  return <LiveTracking token={token} initial={result} />;
}
