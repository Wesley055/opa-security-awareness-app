/**
 * Pure derivation for the public tracking envelope. Deliberately free of
 * Prisma and Nest so it can be tested directly, the same way canonical-fix
 * and canonical-chain are.
 */

/**
 * What the SESSION is doing. Decision 13: staleness is NOT a response
 * state - how old a position is stays a client-side judgement made against
 * serverTime. These four describe the stream, not the fix.
 */
export type JourneyTrackingState =
  | 'AWAITING_FIRST_FIX'
  | 'RECEIVING'
  | 'SILENT'
  | 'ENDED';

/**
 * ACTIVATION means these are the coordinates the emergency was raised at -
 * the immutable origin ADR-005 refuses to overwrite. TRACKED means the
 * position has moved on since.
 */
export type FixOrigin = 'ACTIVATION' | 'TRACKED';

export interface TrackingSessionInput {
  status: string;
  lastFixReceivedAt: Date | null;
}

/**
 * Silence is measured from receivedAt (decision 12), so this threshold is
 * about the STREAM going quiet, not about the position being old.
 * Follows the SOS_DEDUPE_WINDOW_SECONDS idiom.
 */
export const DEFAULT_SILENCE_SECONDS = 120;

export function silenceThresholdSeconds(): number {
  const raw = process.env.JOURNEY_SILENCE_SECONDS;
  if (raw === undefined) {
    return DEFAULT_SILENCE_SECONDS;
  }

  // Throw rather than fall back. A NaN threshold makes every comparison
  // false, so EVERY active session would report SILENT - a false alarm on
  // a page whose whole job is telling a family the phone is still
  // reporting. Falling back to the default would hide the misconfiguration
  // instead. Note an EMPTY string survives ?? and Number() is 0, which is
  // finite and would also silence everything, so <= 0 is rejected too.
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      'JOURNEY_SILENCE_SECONDS must be a positive number, got: ' + raw,
    );
  }

  return value;
}

export function deriveTrackingState(
  session: TrackingSessionInput,
  now: Date,
): JourneyTrackingState {
  if (session.status === 'ENDED') {
    return 'ENDED';
  }

  // No fix has ever been received. Distinct from SILENT, which means the
  // stream started and then stopped - a family reads those very differently.
  if (session.lastFixReceivedAt === null) {
    return 'AWAITING_FIRST_FIX';
  }

  const ageMs = now.getTime() - session.lastFixReceivedAt.getTime();
  const thresholdMs = silenceThresholdSeconds() * 1000;

  return ageMs <= thresholdMs ? 'RECEIVING' : 'SILENT';
}

/**
 * JourneyFixSource is a capture-mode axis. Only the activation fix is the
 * incident origin; foreground, background, manual and retrigger have all
 * moved on from it.
 */
export function deriveFixOrigin(source: string | null | undefined): FixOrigin {
  return source === 'activation' ? 'ACTIVATION' : 'TRACKED';
}
