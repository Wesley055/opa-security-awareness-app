'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueIncident } from '@/lib/operator-queue';

/**
 * The live incident queue. 14A-6.
 *
 * THE ONLY CLIENT COMPONENT IN THE CONSOLE. It holds incidents and polls the
 * same-origin bridge. It never sees a token, an API hostname, or a facility
 * id - the bridge resolves all three server-side.
 *
 * FIVE SECONDS, PAUSED WHEN HIDDEN. An unattended tab left open overnight
 * would otherwise make 17,000 upstream calls before morning. On becoming
 * visible again it fetches immediately rather than waiting out the interval,
 * because the queue on screen is by then as old as the tab was hidden.
 *
 * A FAILED POLL NEVER EMPTIES THE QUEUE. Showing zero emergencies is a
 * claim, and an outage cannot make it. On 503 the last known queue stays on
 * screen with the staleness stated; only a 200 replaces it.
 *
 * 403 STOPS POLLING. A 403 means the account may not read this queue -
 * suspended, demoted, or reassigned. Rotation cannot fix it and retrying
 * every five seconds would hammer the API to be told no 720 times an hour.
 *
 * AGE IS COMPUTED AGAINST serverTime, NOT Date.now(). The bridge stamps
 * serverTime on every response. An operator whose laptop clock is wrong
 * would otherwise see emergencies aged by that error - the tracking page
 * refused to trust the device clock for the same reason.
 */

const POLL_MS = 5000;

type QueueResponse = {
  ok?: boolean;
  incidents?: QueueIncident[];
  nextCursor?: string | null;
  hasMore?: boolean;
  serverTime?: string;
  error?: string;
};

type Status = 'live' | 'stale' | 'stopped';

/** SOS_BUTTON -> SOS Button. Display only. */
function formatEnum(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((word) =>
      word.length <= 3
        ? word
        : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

/**
 * Coordinates arrive as strings from Prisma Decimal. A non-finite value is
 * OMITTED rather than rendered as NaN - public-incident-snapshot.dto.ts set
 * the rule that a value OPA cannot state honestly is left out.
 */
function formatCoords(lat: string | null, lng: string | null): string | null {
  if (!lat || !lng) return null;

  const a = Number(lat);
  const b = Number(lng);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  return `${a.toFixed(5)}, ${b.toFixed(5)}`;
}

function formatAge(createdAt: string, serverTime: string): string {
  const then = new Date(createdAt).getTime();
  const now = new Date(serverTime).getTime();

  if (!Number.isFinite(then) || !Number.isFinite(now)) return '';

  const seconds = Math.max(0, Math.round((now - then) / 1000));

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Fold a fresh first page into what is already loaded.
 *
 * THE NAIVE VERSION LOSES A ROW. Replacing page 1 while keeping later pages
 * seems safe, but if one new incident arrives the fresh page 1 is the old
 * rows 1-24 plus the new one - the old row 25 has fallen off the bottom of
 * page 1 and is not in page 2 either. FacilitiesService says it plainly: in
 * this queue a skipped row is somebody's emergency.
 *
 * hasMore decides which of those two situations applies - see the branches
 * below.
 *
 * AN EARLIER VERSION KEPT A RESOLVED INCIDENT ON SCREEN FOREVER. It fell
 * through to the boundary path on an empty fresh page, took
 * POSITIVE_INFINITY as the boundary, and preserved every existing row. The
 * operator saw a closed emergency until they reloaded. Found by resolving a
 * live incident and watching the queue not change.
 *
 * The hasMore=true branch remains UNEXERCISED: production has never had more
 * than 25 live incidents, so Load more and the boundary merge have not run.
 */
function mergePages(
  existing: QueueIncident[],
  freshFirstPage: QueueIncident[],
  hasMore: boolean,
): QueueIncident[] {
  // THE SERVER SAYS WHETHER PAGE 1 IS THE WHOLE LIVE SET.
  //
  // hasMore=false means there is nothing beyond this page. Anything absent
  // from the fresh page has therefore left the live queue - resolved,
  // cancelled, or otherwise no longer returned. Keeping an absent row here
  // would leave a closed emergency on the operator's screen.
  //
  // This also handles the healthy-empty case without special-casing it:
  // fresh=[] + hasMore=false means the authoritative live set is [].
  if (!hasMore) {
    return freshFirstPage;
  }

  // hasMore=true means page 1 is only the newest window. It makes no claim
  // about rows older than its boundary, so preserve already-loaded rows below
  // that boundary while replacing everything page 1 does speak for.
  //
  // A hasMore=true response with zero rows is internally inconsistent. The
  // caller rejects that shape before reaching here so this index is safe.
  const boundary = new Date(
    freshFirstPage[freshFirstPage.length - 1].createdAt,
  ).getTime();

  const freshIds = new Set(freshFirstPage.map((row) => row.id));

  const older = existing.filter((row) => {
    if (freshIds.has(row.id)) return false;
    return new Date(row.createdAt).getTime() < boundary;
  });

  return [...freshFirstPage, ...older];
}

export function IncidentQueue({
  initialIncidents,
  initialNextCursor,
  initialHasMore,
  initialServerTime,
}: {
  initialIncidents: QueueIncident[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
  initialServerTime: string;
}) {
  const [incidents, setIncidents] = useState(initialIncidents);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [serverTime, setServerTime] = useState(initialServerTime);
  const [status, setStatus] = useState<Status>('live');
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Prevents a slow poll from overlapping the next tick.
  const inFlight = useRef(false);

  /**
   * SYNCHRONOUS, unlike status. A 403 means this account may not read the
   * queue, and that must stop network activity at the moment it is read -
   * not after React commits state and the effect tears the interval down.
   * The already-scheduled tick can fire in between, and an operator whose
   * access was just revoked would make one more request than they are
   * entitled to. A ref closes that window; the state drives the UI.
   */
  const stopped = useRef(false);

  const applyPage = useCallback((data: QueueResponse) => {
    const fresh = data.incidents ?? [];
    const freshHasMore = Boolean(data.hasMore);

    // Impossible contract: the server cannot truthfully say there are more
    // live incidents after returning an empty first page. Preserve the last
    // known queue rather than turning contradictory data into a new truth.
    if (freshHasMore && fresh.length === 0) {
      setStatus('stale');
      setNotice('Updates are temporarily unavailable.');
      return;
    }

    setIncidents((current) =>
      mergePages(current, fresh, freshHasMore),
    );
    setNextCursor(data.nextCursor ?? null);
    setHasMore(freshHasMore);
    if (data.serverTime) setServerTime(data.serverTime);
    setStatus('live');
    setNotice(null);
  }, []);

  const poll = useCallback(async () => {
    if (stopped.current || inFlight.current) return;
    inFlight.current = true;

    try {
      let response = await fetch('/api/operator/incidents', {
        cache: 'no-store',
      });

      if (response.status === 401) {
        // 14A-3's POST exists for exactly this. One attempt, one retry.
        const rotated = await fetch('/api/operator/refresh', {
          method: 'POST',
        });

        if (rotated.status === 401) {
          // Navigation is not instant; the interval can fire during it.
          stopped.current = true;
          window.location.href = '/operator/login?reason=session-ended';
          return;
        }

        if (!rotated.ok) {
          setStatus('stale');
          setNotice('Updates are temporarily unavailable.');
          return;
        }

        response = await fetch('/api/operator/incidents', {
          cache: 'no-store',
        });
      }

      if (response.status === 403) {
        const body = (await response.json().catch(() => ({}))) as QueueResponse;
        // Ref first, and synchronously: the interval may fire again before
        // the state change tears it down.
        stopped.current = true;
        setStatus('stopped');
        setNotice(body.error ?? 'This account can no longer read this queue.');
        return;
      }

      if (!response.ok) {
        // The queue on screen stays. Only a 200 replaces it.
        setStatus('stale');
        setNotice('Updates are temporarily unavailable.');
        return;
      }

      applyPage((await response.json()) as QueueResponse);
    } catch {
      setStatus('stale');
      setNotice('Updates are temporarily unavailable.');
    } finally {
      inFlight.current = false;
    }
  }, [applyPage]);

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
        // The queue is as old as the tab was hidden. Do not wait a tick.
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

  const loadMore = useCallback(async () => {
    if (stopped.current || !nextCursor || loadingMore) return;
    setLoadingMore(true);

    try {
      const response = await fetch(
        `/api/operator/incidents?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: 'no-store' },
      );

      if (!response.ok) {
        setNotice('Could not load more incidents.');
        return;
      }

      const data = (await response.json()) as QueueResponse;
      const page = data.incidents ?? [];

      setIncidents((current) => {
        const known = new Set(current.map((row) => row.id));
        return [...current, ...page.filter((row) => !known.has(row.id))];
      });
      setNextCursor(data.nextCursor ?? null);
      setHasMore(Boolean(data.hasMore));
    } catch {
      setNotice('Could not load more incidents.');
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  return (
    <section className="px-6 py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-ink">
          Active incidents
        </h1>
        <span
          className={
            status === 'live'
              ? 'font-mono text-xs uppercase tracking-widest text-protection'
              : 'font-mono text-xs uppercase tracking-widest text-muted'
          }
        >
          {status === 'live' ? 'Live' : status === 'stale' ? 'Not updating' : 'Stopped'}
        </span>
      </div>

      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      {incidents.length === 0 ? (
        // #184 - AN EMPTY QUEUE IS NOT A BROKEN QUEUE. Say so, rather than
        // leaving a blank panel an operator has to interpret.
        <p className="mt-6 text-sm text-muted">
          No active incidents. New emergencies appear here automatically.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {incidents.map((incident) => {
            const coords = formatCoords(incident.latitude, incident.longitude);
            const where = incident.address?.trim() || coords;
            const name = incident.user
              ? `${incident.user.firstName} ${incident.user.lastName}`.trim()
              : 'Unknown resident';

            return (
              <li
                key={incident.id}
                className="rounded-md border border-line bg-panel px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-display text-lg font-bold text-ink">
                    {name}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-widest text-protection">
                    {formatEnum(incident.status)}
                  </span>
                </div>

                <p className="mt-1 text-sm text-muted">
                  {formatEnum(incident.trigger)}
                  {' \u00b7 '}
                  {formatAge(incident.createdAt, serverTime)}
                  {incident.retriggerCount > 0
                    ? ` \u00b7 re-triggered ${incident.retriggerCount}\u00d7`
                    : ''}
                </p>

                {where ? (
                  <p className="mt-1 font-mono text-xs text-muted">{where}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-6 rounded-md border border-line bg-panel px-4 py-2 text-sm text-ink disabled:opacity-60"
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}