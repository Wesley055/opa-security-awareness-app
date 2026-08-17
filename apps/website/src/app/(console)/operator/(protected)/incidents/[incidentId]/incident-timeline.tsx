import type {
  TimelineEvent,
  TimelineVerification,
} from '@/lib/operator-timeline';

/**
 * The incident timeline. 14A-9. PURELY PRESENTATIONAL - it fetches nothing.
 *
 * IncidentDetailView owns the single 5-second poll and passes events and
 * verification down. Two timers would allow the header to say LIVE while
 * this sat several intervals behind.
 *
 * AN UNRECOGNISED EVENT TYPE STILL RENDERS. type is a free-form string on
 * the API side and nothing stops an eighth value appearing. An audit trail
 * that silently drops an event it cannot label is worse than one showing a
 * formatted version of the raw type.
 *
 * INTEGRITY HAS THREE STATES, NOT TWO. Verified, failed, and UNKNOWN -
 * because a failed request is not a failed chain. Rendering a tampering
 * warning because the network was down would be a serious false alarm; the
 * public site already tells customers each entry can be independently
 * verified, so this indicator has to mean what it says.
 */

const TYPE_LABELS: Record<string, string> = {
  INCIDENT_CREATED: 'Incident created',
  LOCATION_ATTACHED: 'Location attached',
  NOTIFICATIONS_QUEUED: 'Notifications queued',
  SOS_RETRIGGERED: 'SOS re-triggered',
  EVIDENCE_ADDED: 'Evidence added',
  INCIDENT_RESOLVED: 'Incident resolved',
  INCIDENT_CANCELLED: 'Incident cancelled',
};

/** USER_SAFE reads better as a sentence than as a formatted enum. */
const REASON_LABELS: Record<string, string> = {
  USER_SAFE: 'Resident reported safe',
  FALSE_ALARM: 'Reported as a false alarm',
};

function formatEnum(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 ? word : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

function label(type: string): string {
  return TYPE_LABELS[type] ?? formatEnum(type);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function coords(display: Record<string, unknown>): string | null {
  const lat = num(display.latitude);
  const lng = num(display.longitude);
  return lat === null || lng === null ? null : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * One line of detail beneath the event label, or null.
 *
 * Every branch reads fields that may be absent - the API's allowlist is a
 * presence-preserving filter, so a key missing from the payload is missing
 * here too. Nothing is assumed present.
 */
function detailLine(event: TimelineEvent): string | null {
  const d = event.display;

  switch (event.type) {
    case 'INCIDENT_CREATED': {
      const trigger = text(d.trigger);
      const parts: string[] = [];
      if (trigger) parts.push(formatEnum(trigger));
      if (d.silentMode === true) parts.push('Silent activation');
      return parts.length ? parts.join(' \u00b7 ') : null;
    }

    case 'LOCATION_ATTACHED':
      return coords(d);

    case 'NOTIFICATIONS_QUEUED': {
      const queued = num(d.queued);
      if (queued === null) return null;
      // Zero is a real answer and an operator needs it: nobody was reached.
      return queued === 1 ? '1 recipient queued' : `${queued} recipients queued`;
    }

    case 'SOS_RETRIGGERED': {
      const parts: string[] = [];
      const method = text(d.triggerMethod);
      if (method) parts.push(formatEnum(method));
      const position = coords(d);
      if (position) parts.push(position);
      const count = num(d.retriggerCount);
      if (count !== null) parts.push(`re-trigger ${count}`);
      const since = num(d.secondsSinceInitialTrigger);
      if (since !== null) parts.push(`${since}s after the first`);
      return parts.length ? parts.join(' \u00b7 ') : null;
    }

    case 'EVIDENCE_ADDED': {
      const parts: string[] = [];
      const kind = text(d.evidenceType);
      if (kind) parts.push(formatEnum(kind));
      const size = num(d.sizeBytes);
      if (size !== null) parts.push(`${Math.round(size / 1024)} kB`);
      return parts.length ? parts.join(' \u00b7 ') : null;
    }

    case 'INCIDENT_RESOLVED':
    case 'INCIDENT_CANCELLED': {
      const reason = text(d.reason);
      if (reason) return REASON_LABELS[reason] ?? formatEnum(reason);
      // close() omits reason when none was given. Fall back to the
      // transition, which is always present.
      const from = text(d.previousStatus);
      const to = text(d.newStatus);
      return from && to ? `${formatEnum(from)} \u2192 ${formatEnum(to)}` : null;
    }

    default:
      // Unknown type. The API returns an empty display for these, so there
      // is nothing to show beyond the label and the time.
      return null;
  }
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

function IntegrityBanner({
  verification,
}: {
  verification: TimelineVerification | null;
}) {
  if (verification === null) {
    return (
      <span className="inline-flex rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-xs uppercase tracking-widest text-muted">
        Integrity unknown
      </span>
    );
  }

  if (verification.valid) {
    return (
      <span className="inline-flex rounded-full border border-protection/30 bg-protection/10 px-2.5 py-1 font-mono text-xs uppercase tracking-widest text-protection">
        &#10003; Integrity verified
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-emergency/40 bg-emergency/10 px-2.5 py-1 font-mono text-xs uppercase tracking-widest text-emergency">
      &#9888; Integrity check failed
    </span>
  );
}

export function IncidentTimeline({
  events,
  verification,
}: {
  events: TimelineEvent[];
  /** null means OPA could not check - NOT that the chain is broken. */
  verification: TimelineVerification | null;
}) {
  const broken = verification !== null && !verification.valid;

  return (
    <section className="rounded-xl border border-line bg-panel p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">
          Incident timeline
        </h2>
        <IntegrityBanner verification={verification} />
      </div>

      {broken ? (
        // CONSPICUOUS, AND ABOVE THE EVENTS. The timeline still renders -
        // hiding it would destroy the only record of what happened - but an
        // operator must not read it as trustworthy.
        <div
          role="alert"
          className="mt-4 rounded-lg border border-emergency/40 bg-emergency/10 px-4 py-3"
        >
          <p className="text-sm font-bold text-emergency">
            Incident record integrity check failed
          </p>
          <p className="mt-1 text-sm text-ink">
            {typeof verification?.brokenAtSequence === 'number'
              ? `Timeline entry ${verification.brokenAtSequence} could not be verified.`
              : 'This timeline could not be verified.'}{' '}
            Treat this history as potentially incomplete or altered.
          </p>
        </div>
      ) : null}

      {events.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          No timeline entries have been recorded for this incident.
        </p>
      ) : (
        <ol className="mt-6 border-l border-line">
          {events.map((event) => {
            const line = detailLine(event);

            return (
              <li
                key={event.sequence}
                className="relative grid gap-1 py-3 pl-5 sm:grid-cols-[9rem_1fr] sm:gap-4 sm:pl-6"
              >
                <span
                  aria-hidden="true"
                  className="absolute -left-[5px] top-[1.15rem] h-2 w-2 rounded-full bg-protection"
                />

                <span
                  suppressHydrationWarning
                  className="font-mono text-xs text-muted"
                >
                  {clockTime(event.occurredAt)}
                </span>

                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {label(event.type)}
                  </p>

                  {line ? (
                    <p className="mt-1 break-words font-mono text-xs leading-5 text-muted">
                      {line}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}