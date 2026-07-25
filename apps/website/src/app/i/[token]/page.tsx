import type { Metadata } from 'next';
import { fetchTracking } from '@/lib/tracking';
import type {
  ClosedIncident,
  PublicIncidentSnapshot,
} from '@/lib/tracking';

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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function relativeMinutes(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

function Shell({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'alert' | 'neutral';
}) {
  return (
    <main className="min-h-screen bg-base px-5 py-10">
      <div className="mx-auto max-w-lg">
        <div
          className={`rounded-lg border p-6 sm:p-8 ${
            tone === 'alert' ? 'border-emergency' : 'border-line'
          }`}
        >
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          OPA &middot; opasafety.com
        </p>
      </div>
    </main>
  );
}

function ActiveAlert({ incident }: { incident: PublicIncidentSnapshot }) {
  const mapsUrl = `https://maps.google.com/?q=${incident.location.latitude},${incident.location.longitude}`;
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${
    incident.location.longitude - 0.008
  }%2C${incident.location.latitude - 0.006}%2C${
    incident.location.longitude + 0.008
  }%2C${incident.location.latitude + 0.006}&layer=mapnik&marker=${
    incident.location.latitude
  }%2C${incident.location.longitude}`;

  return (
    <Shell tone="alert">
      <p className="font-display text-xs font-bold uppercase tracking-widest text-emergency">
        Emergency alert
      </p>
      <h1 className="mt-2 font-display text-2xl font-extrabold text-ink">
        {incident.personName} may be in danger
      </h1>
      <p className="mt-2 text-sm text-muted">
        Alert triggered {relativeMinutes(incident.triggeredAt)} &middot;{' '}
        {formatTime(incident.triggeredAt)}
      </p>

      {incident.retriggerCount > 0 && incident.lastRetriggeredAt && (
        <p className="mt-4 rounded-md border-l-2 border-emergency bg-emergency/5 px-4 py-3 text-sm text-ink">
          The SOS was triggered again{' '}
          {relativeMinutes(incident.lastRetriggeredAt)}
          {incident.retriggerCount > 1 &&
            ` (${incident.retriggerCount} times in total)`}
          .
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-md border border-line">
        <iframe
          src={embedUrl}
          title="Location where the alert was triggered"
          className="h-56 w-full"
          loading="lazy"
          // Belt and braces: the page already sends no-referrer, but the
          // iframe must never carry the token to a third-party map host.
          referrerPolicy="no-referrer"
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        Location captured when the alert was triggered. It does not update.
      </p>

      <a
        href={mapsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-5 flex w-full items-center justify-center rounded-md bg-emergency px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
      >
        Open in Maps
      </a>

      <div className="mt-6 border-t border-line pt-5">
        <p className="text-sm font-semibold text-ink">What you can do</p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>Try calling {incident.personName.split(' ')[0]} directly.</li>
          <li>
            If you believe there is immediate danger, contact the emergency
            services on <span className="font-semibold text-ink">112</span>.
          </li>
        </ul>
        <p className="mt-4 text-xs text-muted">
          OPA alerts the contacts this person chose. It does not contact the
          police, hospitals or emergency services on their behalf.
        </p>
      </div>
    </Shell>
  );
}

function ClosedAlert({ incident }: { incident: ClosedIncident }) {
  return (
    <Shell>
      <h1 className="font-display text-xl font-bold text-ink">
        This alert has ended
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        The emergency alert for {incident.personName} was closed
        {incident.resolvedAt ? ` on ${formatTime(incident.resolvedAt)}` : ''}.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Location information is no longer shared through this link.
      </p>
    </Shell>
  );
}

function ExpiredLink() {
  return (
    <Shell>
      <h1 className="font-display text-xl font-bold text-ink">
        This link has expired
      </h1>
      {/*
        Deliberately does NOT say the incident ended. It may still be active,
        and telling a family otherwise could convince them the emergency is
        over while their relative is still in danger.
      */}
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Tracking links expire for privacy and safety. The alert may still be
        active.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Contact the person directly, or call{' '}
        <span className="font-semibold text-ink">112</span> if you believe
        someone is in immediate danger.
      </p>
    </Shell>
  );
}

function InvalidLink() {
  return (
    <Shell>
      <h1 className="font-display text-xl font-bold text-ink">
        This link is not valid
      </h1>
      {/* Reveals nothing about whether an incident ever existed. */}
      <p className="mt-3 text-sm leading-relaxed text-muted">
        This tracking link cannot be opened. It may have been withdrawn, or the
        address may be incomplete.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        If you received this from someone who may be in danger, contact them
        directly or call{' '}
        <span className="font-semibold text-ink">112</span>.
      </p>
    </Shell>
  );
}

function Unavailable() {
  return (
    <Shell>
      <h1 className="font-display text-xl font-bold text-ink">
        We cannot load this alert right now
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Something went wrong on our side. Please refresh in a moment.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Do not wait on this page if you believe someone is in danger. Contact
        them directly or call{' '}
        <span className="font-semibold text-ink">112</span>.
      </p>
    </Shell>
  );
}

export default async function TrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await fetchTracking(token);

  switch (result.state) {
    case 'VALID':
      return <ActiveAlert incident={result.incident} />;
    case 'INCIDENT_CLOSED':
      return <ClosedAlert incident={result.incident} />;
    case 'EXPIRED':
      return <ExpiredLink />;
    case 'UNAVAILABLE':
      return <Unavailable />;
    // Revoked and unknown links are deliberately indistinguishable.
    case 'REVOKED':
    case 'NOT_FOUND':
    default:
      return <InvalidLink />;
  }
}
