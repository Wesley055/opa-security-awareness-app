'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IncidentDetail } from '@/lib/operator-incident';
import type {
  TimelineEvent,
  TimelineVerification,
} from '@/lib/operator-timeline';
import { IncidentTimeline } from './incident-timeline';

/**
 * One incident, kept current. 14A-7.
 *
 * SAME OPERATIONAL RULES AS THE QUEUE. Five seconds, paused while the tab
 * is hidden, an immediate fetch on becoming visible, 401 recovered by one
 * rotation and one retry, and a failed poll NEVER replaces what is on
 * screen - only a 200 does.
 *
 * 403 AND 404 STOP POLLING, SYNCHRONOUSLY. Neither can be fixed by
 * rotating a token, and retrying every five seconds would ask the API 720
 * times an hour to be told no. The ref is set before the state change
 * because an already-scheduled tick can fire before React tears the
 * interval down.
 *
 * WHY POLL A SINGLE INCIDENT AT ALL: it changes while an operator watches.
 * The resident can resolve or cancel it, and re-taps raise retriggerCount -
 * which the tracking DTO notes may signal rising distress.
 */

const POLL_MS = 5000;

type DetailResponse = {
  ok?: boolean;
  incident?: IncidentDetail;
  serverTime?: string;
  error?: string;
};

type Status = 'live' | 'stale' | 'stopped';

function formatEnum(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 ? word : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

function formatCoords(lat: string | null, lng: string | null): string | null {
  if (!lat || !lng) return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `${a.toFixed(5)}, ${b.toFixed(5)}`;
}

function formatAge(from: string, serverTime: string): string {
  const then = new Date(from).getTime();
  const now = new Date(serverTime).getTime();
  if (!Number.isFinite(then) || !Number.isFinite(now)) return '';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Absolute timestamps use the operator terminal's local timezone.
 *
 * No explicit timeZone is supplied. Until Facility has a timezone field,
 * browser-local display is more truthful than imposing a country assumption.
 *
 * The value may render differently during server pre-render and browser
 * hydration, so timestamp nodes use suppressHydrationWarning.
 */
function formatLocalDateTime(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

/**
 * UNTRUSTED DEVICE TEXT, capped for display only. The API is not asked to
 * truncate; what is stored stays whole. React escapes it, so this is not an
 * injection guard - it is a guard against an arbitrarily long string from a
 * device breaking the page an operator is reading during an emergency.
 */
function displayVoicePhrase(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > 200 ? `${text.slice(0, 200)}\u2026` : text;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-panel-2/60 p-4">
      <dt className="font-mono text-xs uppercase tracking-widest text-muted">
        {label}
      </dt>
      <dd className="mt-2 break-words text-sm leading-6 text-ink">{children}</dd>
    </div>
  );
}

export function IncidentDetailView({
  initialIncident,
  initialServerTime,
  initialTimeline,
  initialVerification,
}: {
  initialIncident: IncidentDetail;
  initialServerTime: string;
  initialTimeline: TimelineEvent[];
  /** null means OPA could not check - NOT that the chain is broken. */
  initialVerification: TimelineVerification | null;
}) {
  const [incident, setIncident] = useState(initialIncident);
  const [serverTime, setServerTime] = useState(initialServerTime);
  const [status, setStatus] = useState<Status>('live');
  const [notice, setNotice] = useState<string | null>(null);

  const [timeline, setTimeline] = useState(initialTimeline);
  const [verification, setVerification] = useState(initialVerification);

  /**
   * The last sequence this component has seen. sequence is monotonic
   * and unique per incident, so a change IS an append - which is the
   * only reason to re-run verification.
   */
  const lastSequence = useRef(
    initialTimeline.length
      ? initialTimeline[initialTimeline.length - 1].sequence
      : 0,
  );

  /**
   * A closed incident cannot gain events, so its timeline is fetched
   * once and never again. Set on the TERMINAL TRANSITION rather than
   * on first seeing a terminal status, because the event that RECORDS
   * a resolution is appended by the same operation that makes the
   * status terminal - stopping the moment status flips would miss it.
   */
  const timelineSettled = useRef(
    initialIncident.status === 'RESOLVED' ||
      initialIncident.status === 'CANCELLED',
  );

  const inFlight = useRef(false);
  const stopped = useRef(false);

  /**
   * Refetch the timeline, and verification ONLY if it grew.
   *
   * A failure here is silent by design: the detail poll owns the
   * stale indicator, and a timeline that could not be refreshed is
   * still the last thing OPA knew. Replacing it with nothing would
   * claim an incident has no history.
   */
  const refreshTimeline = useCallback(async () => {
    const base = `/api/operator/incidents/${encodeURIComponent(
      initialIncident.id,
    )}/timeline`;

    try {
      const response = await fetch(base, { cache: 'no-store' });
      if (!response.ok) return;

      const data = (await response.json()) as {
        events?: TimelineEvent[];
      };
      if (!Array.isArray(data.events)) return;

      setTimeline(data.events);

      const latest = data.events.length
        ? data.events[data.events.length - 1].sequence
        : 0;

      if (latest === lastSequence.current) return;
      lastSequence.current = latest;

      const checked = await fetch(`${base}/verify`, { cache: 'no-store' });
      if (!checked.ok) {
        // OPA does not know. NOT the same as a broken chain.
        setVerification(null);
        return;
      }

      const body = (await checked.json()) as {
        verification?: TimelineVerification;
      };
      if (typeof body.verification?.valid === 'boolean') {
        setVerification(body.verification);
      }
    } catch {
      // Keep what is on screen.
    }
  }, [initialIncident.id]);

  const poll = useCallback(async () => {
    if (stopped.current || inFlight.current) return;
    inFlight.current = true;

    const url = `/api/operator/incidents/${encodeURIComponent(initialIncident.id)}`;

    try {
      let response = await fetch(url, { cache: 'no-store' });

      if (response.status === 401) {
        const rotated = await fetch('/api/operator/refresh', { method: 'POST' });

        if (rotated.status === 401) {
          stopped.current = true;
          window.location.href = '/operator/login?reason=session-ended';
          return;
        }

        if (!rotated.ok) {
          setStatus('stale');
          setNotice('Updates are temporarily unavailable.');
          return;
        }

        response = await fetch(url, { cache: 'no-store' });
      }

      if (response.status === 403 || response.status === 404) {
        const body = (await response.json().catch(() => ({}))) as DetailResponse;
        stopped.current = true;
        setStatus('stopped');
        setNotice(
          body.error ?? 'This incident is no longer available to you.',
        );
        return;
      }

      if (!response.ok) {
        // What is on screen stays. Only a 200 replaces it.
        setStatus('stale');
        setNotice('Updates are temporarily unavailable.');
        return;
      }

      const data = (await response.json()) as DetailResponse;

      if (!data.incident?.id) {
        setStatus('stale');
        setNotice('Updates are temporarily unavailable.');
        return;
      }

      setIncident(data.incident);
      if (data.serverTime) setServerTime(data.serverTime);
      setStatus('live');
      setNotice(null);

      // Same tick, same lifecycle state. A failed timeline fetch leaves
      // what is on screen alone - only a 200 replaces it.
      if (!timelineSettled.current) {
        await refreshTimeline();

        if (data.incident.status === 'RESOLVED' ||
            data.incident.status === 'CANCELLED') {
          timelineSettled.current = true;
        }
      }
    } catch {
      setStatus('stale');
      setNotice('Updates are temporarily unavailable.');
    } finally {
      inFlight.current = false;
    }
  }, [initialIncident.id, refreshTimeline]);

  useEffect(() => {
    if (status === 'stopped') return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(poll, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void poll();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll, status]);

  const name = incident.user
    ? `${incident.user.firstName} ${incident.user.lastName}`.trim()
    : 'Unknown resident';
  const coords = formatCoords(incident.latitude, incident.longitude);
  const phrase = displayVoicePhrase(incident.voicePhrase);
  const isClosed =
    incident.status === 'RESOLVED' || incident.status === 'CANCELLED';

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-line bg-panel p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-widest text-muted">
              {isClosed ? 'Incident record' : 'Active incident'}
            </p>

            <h1 className="mt-2 break-words font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {name}
            </h1>

            <span
              className={
                incident.status === 'RESOLVED'
                  ? 'mt-3 inline-flex rounded-full border border-success/30 bg-success/10 px-2.5 py-1 font-mono text-xs uppercase tracking-widest text-success'
                  : incident.status === 'CANCELLED'
                    ? 'mt-3 inline-flex rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-xs uppercase tracking-widest text-muted'
                    : 'mt-3 inline-flex rounded-full border border-emergency/30 bg-emergency/10 px-2.5 py-1 font-mono text-xs uppercase tracking-widest text-emergency'
              }
            >
              {formatEnum(incident.status)}
            </span>
          </div>

          <span
            className={
              status === 'live'
                ? 'inline-flex w-fit rounded-full border border-protection/30 bg-protection/10 px-3 py-1 font-mono text-xs uppercase tracking-widest text-protection'
                : 'inline-flex w-fit rounded-full border border-line bg-panel-2 px-3 py-1 font-mono text-xs uppercase tracking-widest text-muted'
            }
          >
            {status === 'live'
              ? 'Live'
              : status === 'stale'
                ? 'Not updating'
                : 'Stopped'}
          </span>
        </div>

      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

        <dl className="mt-6 grid gap-3 md:grid-cols-2">
        <Row label="Triggered by">{formatEnum(incident.trigger)}</Row>

        <Row label="Raised">
          {formatAge(incident.createdAt, serverTime)}
          <span
            suppressHydrationWarning
            className="ml-2 font-mono text-xs text-muted"
          >
            {formatLocalDateTime(incident.createdAt)}
          </span>
        </Row>

        <Row label="Location">
          {incident.address?.trim() ? (
            <>
              <span>{incident.address.trim()}</span>
              {coords ? (
                <span className="ml-2 font-mono text-xs text-muted">
                  {coords}
                </span>
              ) : null}
            </>
          ) : coords ? (
            <span className="font-mono">{coords}</span>
          ) : (
            <span className="text-muted">No usable position recorded.</span>
          )}
        </Row>

        {incident.retriggerCount > 0 ? (
          <Row label="Re-triggered">
            {incident.retriggerCount}
            {incident.retriggerCount === 1 ? ' time' : ' times'}
          </Row>
        ) : null}

        {phrase ? <Row label="Voice phrase">{phrase}</Row> : null}

        {/*
          PRESENCE, NOT LIVENESS. The detail projection returns the session
          id and NOT its state, and close() ends the session when an
          incident resolves - so a linked id on a closed incident belongs to
          a stream that has stopped. Saying "live" here would be untrue.
          14A-8 reads the state and may then say more.
        */}
        <Row label="Location tracking">
          {incident.journeySessionId
            ? 'A location tracking session is linked to this incident.'
            : 'No location tracking session is linked to this incident.'}
        </Row>

        {incident.status === 'RESOLVED' ? (
          <Row label="Resolved">
            {incident.resolvedAt ? (
              <>
                {formatAge(incident.resolvedAt, serverTime)}
                {' · '}
                <span suppressHydrationWarning>
                  {formatLocalDateTime(incident.resolvedAt)}
                </span>
              </>
            ) : (
              'Marked resolved.'
            )}
          </Row>
        ) : null}

        {incident.status === 'CANCELLED' ? (
          // resolvedAt is deliberately null for a cancellation. Rendering an
          // empty timestamp would look like missing data; the cancellation
          // time lives on the timeline, which arrives in 14A-9.
          <Row label="Cancelled">
            The resident reported this activation as accidental.
          </Row>
        ) : null}
      </dl>

        {isClosed ? (
          <p className="mt-6 max-w-prose rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm text-muted">
            This incident is closed. Only the resident can close an incident;
            the Command Center does not.
          </p>
        ) : null}
      </section>

      <IncidentTimeline events={timeline} verification={verification} />
    </div>
  );
}