'use client';

/**
 * Live tracking view for the public incident page.
 *
 * The views below were MOVED here unchanged from page.tsx so they can
 * re-render as new snapshots arrive. Polling goes to the SAME-ORIGIN route
 * at /api/tracking/<token>, which proxies to the OPA API server-side: the
 * API hostname never reaches client code and no cross-origin request ever
 * carries the token.
 */

import { useEffect, useRef, useState } from 'react';
import type {
  ClosedIncident,
  PublicIncidentSnapshot,
  TrackingResult,
} from '@/lib/tracking';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * One place for the age wording, so the alert age and the location age
 * cannot drift apart. Floor, never round: on an emergency page, rounding
 * up would claim more elapsed time than has actually passed. Clamped at
 * zero because a device clock slightly ahead of the server must not
 * render a negative age.
 */
function humanAge(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  if (safeMinutes < 1) return 'less than a minute ago';
  if (safeMinutes === 1) return '1 minute ago';
  if (safeMinutes < 60) return `${safeMinutes} minutes ago`;
  const hours = Math.floor(safeMinutes / 60);
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// Was Date.now(). Server-rendered that WAS the server clock; client-side
// it would silently become the browser clock. The caller passes
// serverTime so the reading stays server-relative.
function relativeMinutes(iso: string, now: number): string {
  return humanAge((now - new Date(iso).getTime()) / 60000);
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

function ActiveAlert({
  incident,
  serverTime,
}: {
  incident: PublicIncidentSnapshot;
  serverTime: string;
}) {
  const now = Date.parse(serverTime);
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
        Alert triggered {relativeMinutes(incident.triggeredAt, now)} &middot;{' '}
        {formatTime(incident.triggeredAt)}
      </p>

      {incident.retriggerCount > 0 && incident.lastRetriggeredAt && (
        <p className="mt-4 rounded-md border-l-2 border-emergency bg-emergency/5 px-4 py-3 text-sm text-ink">
          The SOS was triggered again{' '}
          {relativeMinutes(incident.lastRetriggeredAt, now)}
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

      <StreamStatus incident={incident} serverTime={serverTime} />

      {/*
        Kept verbatim for incidents with no journey session, where it is
        still exactly true. Shown ONLY then: once a stream exists this
        sentence would be a reassuring lie.
      */}
      {incident.tracking === undefined && (
        <p className="mt-3 text-xs text-muted">
          Location captured when the alert was triggered. It does not update.
        </p>
      )}

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


/** Eight polls inside the 120s silence window: current without being noisy. */
const POLL_MS = 15000;

/**
 * Terminal with respect to THIS capability token. Note SILENT is absent on
 * purpose - it is an observation about the stream, not an ending, and a
 * device that regains signal must be able to bring the page back to life.
 * UNAVAILABLE is absent too: that is our infrastructure, not the incident.
 */
const TERMINAL: readonly string[] = [
  'INCIDENT_CLOSED',
  'EXPIRED',
  'REVOKED',
  'NOT_FOUND',
];

/** Both values come from the server, so the browser clock never enters this. */
function ageSeconds(serverTime: string, iso: string): number {
  const ms = Date.parse(serverTime) - Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
}

function describeAge(seconds: number): string {
  if (seconds < 60) return 'moments ago';
  return humanAge(seconds / 60);
}

function StreamStatus({
  incident,
  serverTime,
}: {
  incident: PublicIncidentSnapshot;
  serverTime: string;
}) {
  const tracking = incident.tracking;

  // ABSENT means this incident has no journey session at all - every
  // incident raised before Sprint 10B Step 4. Render nothing: the feature
  // genuinely does not exist for it, and a badge would imply otherwise.
  if (tracking === undefined) {
    return null;
  }

  const age = describeAge(
    ageSeconds(serverTime, incident.location.capturedAt),
  );

  if (tracking.state === 'AWAITING_FIRST_FIX') {
    return (
      <p className="mt-3 text-xs text-muted">
        Waiting for the first location update from this phone. The position
        above is where the alert was triggered.
      </p>
    );
  }

  if (tracking.state === 'RECEIVING') {
    return (
      <p className="mt-3 text-xs text-muted">
        Location is updating &middot; captured {age}.
      </p>
    );
  }

  if (tracking.state === 'SILENT') {
    return (
      <p className="mt-3 rounded-md border-l-2 border-line bg-base px-4 py-3 text-xs text-muted">
        Last location captured {age}. The phone may have lost signal, battery
        or connection. This does not mean the alert has ended.
      </p>
    );
  }

  // ENDED: the SESSION stopped. The incident itself may still be open, so
  // the wording must not suggest the emergency is over.
  return (
    <p className="mt-3 text-xs text-muted">
      Location updates have stopped. The last position was captured {age}.
    </p>
  );
}

export function LiveTracking({
  token,
  initial,
}: {
  token: string;
  initial: TrackingResult;
}) {
  const [result, setResult] = useState<TrackingResult>(initial);
  // Guards against pile-ups if a poll outlives the interval. fetchTracking
  // allows up to 8s server-side, so this is not hypothetical.
  const inFlight = useRef(false);

  useEffect(() => {
    if (TERMINAL.includes(result.state)) {
      return;
    }

    const id = setInterval(() => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;

      void fetch(`/api/tracking/${encodeURIComponent(token)}`, {
        cache: 'no-store',
      })
        .then((response) => response.json())
        .then((next: TrackingResult) => setResult(next))
        .catch(() => {
          // Keep the last good render and try again on the next tick.
          // Never surface a transient network blip as an incident state.
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, POLL_MS);

    return () => clearInterval(id);
  }, [token, result.state]);

  if (result.state === 'VALID') {
    return (
      <ActiveAlert incident={result.incident} serverTime={result.serverTime} />
    );
  }
  if (result.state === 'INCIDENT_CLOSED') {
    return <ClosedAlert incident={result.incident} />;
  }
  if (result.state === 'EXPIRED') {
    return <ExpiredLink />;
  }
  if (result.state === 'UNAVAILABLE') {
    return <Unavailable />;
  }
  // Revoked and unknown links are deliberately indistinguishable.
  return <InvalidLink />;
}
