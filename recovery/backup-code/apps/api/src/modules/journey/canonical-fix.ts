import { Prisma } from '@prisma/client';

/**
 * Canonical serialisation for JourneyLocationFix hash inputs.
 *
 * WHY THIS EXISTS
 * accuracy, speed and heading are stored as DOUBLE PRECISION and are hash
 * inputs. Migrating them to Decimal was considered and rejected: the device
 * supplies them as JS floats anyway, so Decimal storage would make the
 * round-trip exact without making the input exact. Fixed-precision
 * canonicalisation solves the actual failure mode.
 *
 * RUNS ON READ AS WELL AS WRITE
 * Verification re-derives the string from the stored double using this same
 * function, so 12.100000000000001 and 12.1 both canonicalise to "12.10".
 * Do NOT "optimise" by storing the canonical string: the two paths would
 * drift and verification would silently start comparing a value against
 * itself.
 *
 * NEVER call Prisma.Decimal.set(). That constructor is shared with Prisma
 * own decimal handling; a global rounding change would leak into unrelated
 * code. Rounding mode is passed explicitly to every toFixed call.
 */

const Decimal = Prisma.Decimal;
type DecimalValue = InstanceType<typeof Prisma.Decimal>;

/** Round half away from zero, per ADR-009. decimal.js ROUND_HALF_UP = 4. */
export const ROUNDING = 4;

export const CANONICAL_VERSION = 'v1';

/**
 * One fixed token for null.
 *
 * This deliberately diverges from decision 15 omission principle, which
 * binds the wire DTO only. Hash inputs cannot omit a field: omission would
 * make two different fixes hash identically. Recorded so the two are not
 * later "harmonised" by someone who reads one rule and not the other.
 */
export const NULL_TOKEN = 'null';

export type NumericInput = number | string | DecimalValue | null | undefined;

function toDecimal(value: number | string | DecimalValue): DecimalValue {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Cannot canonicalise a non-finite number: ' + value);
  }

  // decimal.js converts a JS number via its shortest round-trip string, so
  // new Decimal(1.005) holds exactly 1.005 rather than the binary double
  // 1.00499999999999989. This is precisely why Number.prototype.toFixed is
  // unusable here: (1.005).toFixed(2) returns "1.00" in V8.
  const d = new Decimal(value as never);

  if (!d.isFinite()) {
    throw new Error('Cannot canonicalise a non-finite value.');
  }

  return d;
}

/** Formats to exactly dp fractional digits. Normalises -0 to 0. */
export function canonicalNumber(value: NumericInput, dp: number): string {
  if (value === null || value === undefined) return NULL_TOKEN;

  let d = toDecimal(value);

  // -0 must not emit "-0.00". speed and heading can both produce it.
  if (d.isZero()) d = new Decimal(0);

  const out = d.toFixed(dp, ROUNDING);

  // toFixed can still return "-0.00" for a tiny negative that rounds to zero.
  return out.replace(/^-(0(?:\.0+)?)$/, '$1');
}

/** latitude and longitude: Decimal(9,6), exactly 6 fractional digits. */
export function canonicalCoordinate(value: NumericInput): string {
  return canonicalNumber(value, 6);
}

/** accuracy and speed: exactly 2 fractional digits. */
export function canonicalAccuracy(value: NumericInput): string {
  return canonicalNumber(value, 2);
}

export const canonicalSpeed = canonicalAccuracy;

/**
 * GPS returns -1 for unknown heading. That is null, not a bearing, and must
 * be nulled before storage rather than stored as -1.
 *
 * SCOPE: -1 is the ONLY sentinel handled here. Any other out-of-range
 * heading is a validation concern, not a canonicalisation one: the
 * ingestion validator rejects heading outside [0, 360) before storage.
 * canonicalHeading wraps defensively so the hash function is total, but
 * in production that path should be unreachable. If ADR-009 ever changes
 * this policy, change both places: wrapping and rejecting are
 * contradictory rules if only one of them is read.
 */
export function normaliseHeading(value: NumericInput): number | null {
  if (value === null || value === undefined) return null;

  const d = toDecimal(value);
  if (d.isNegative() && d.equals(-1)) return null;

  return d.toNumber();
}

/** heading: normalised to [0, 360), exactly 1 fractional digit. */
export function canonicalHeading(value: NumericInput): string {
  if (value === null || value === undefined) return NULL_TOKEN;

  const d = toDecimal(value);
  if (d.equals(-1)) return NULL_TOKEN;

  // ((h % 360) + 360) % 360, in decimal arithmetic.
  let wrapped = d.mod(360).plus(360).mod(360);

  let out = wrapped.toFixed(1, ROUNDING);

  // 359.96 rounds to 360.0, which is outside the range. Re-wrap after
  // rounding, not before.
  if (new Decimal(out).greaterThanOrEqualTo(360)) {
    wrapped = new Decimal(0);
    out = wrapped.toFixed(1, ROUNDING);
  }

  return out.replace(/^-(0(?:\.0+)?)$/, '$1');
}

/** UTC only, ISO 8601, exactly millisecond precision. */
export function canonicalTimestamp(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(d.getTime())) {
    throw new Error('Cannot canonicalise an invalid date: ' + String(value));
  }

  // toISOString is always UTC with exactly 3 fractional digits.
  return d.toISOString();
}

export interface CanonicalFixInput {
  nonce: string;
  latitude: NumericInput;
  longitude: NumericInput;
  accuracy: NumericInput;
  speed: NumericInput;
  heading: NumericInput;
  recordedAt: Date | string;
}

/**
 * The bytes that payloadHash covers. Field order is fixed, no whitespace,
 * period decimal separator, no scientific notation, no trimmed zeroes.
 *
 * Version-prefixed so a future format change is detectable rather than
 * silently incompatible with rows hashed under the old rules.
 */
export function canonicalFixPayload(input: CanonicalFixInput): string {
  if (!input.nonce) {
    throw new Error('nonce is required: it is what makes the payload hash ' +
      'resistant to brute force over low-entropy coordinates.');
  }

  return [
    CANONICAL_VERSION,
    'nonce=' + input.nonce,
    'lat=' + canonicalCoordinate(input.latitude),
    'lng=' + canonicalCoordinate(input.longitude),
    'acc=' + canonicalAccuracy(input.accuracy),
    'spd=' + canonicalSpeed(input.speed),
    'hdg=' + canonicalHeading(input.heading),
    'rec=' + canonicalTimestamp(input.recordedAt),
  ].join('|');
}
