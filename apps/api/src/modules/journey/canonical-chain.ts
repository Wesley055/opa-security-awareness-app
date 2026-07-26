/**
 * Canonical serialisation for the JourneyLocationFix hash CHAIN.
 *
 * SCOPE
 * canonical-fix.ts owns the PAYLOAD envelope: the bytes that payloadHash
 * covers. This module owns the CHAIN envelope: the bytes that hash covers,
 * linking each fix to its predecessor in RECEIPT order (decision 8).
 *
 * SAME CONVENTIONS, SEPARATE ENVELOPE
 * Both are version-prefixed and field-labelled, for the same two reasons: a
 * format change must be detectable rather than silently incompatible with
 * rows already hashed under the old rules, and a cross-language
 * implementation must not be able to transpose two same-shaped fields.
 *
 * The labels also give the two envelopes domain separation for free. A chain
 * preimage begins v1|prev= and a payload preimage begins v1|nonce=, so no
 * chain preimage can ever equal a payload preimage.
 *
 * NOTHING HERE IMPORTS PRISMA.
 * The chain envelope is deliberately ORM-free so it can be reimplemented in
 * another language against the fixture vectors.
 *
 * VERSION COUPLING IS DELIBERATE
 * CANONICAL_VERSION is shared with the payload envelope: one version
 * namespace for canonical serialisation. The consequence is that bumping
 * either format bumps both. If the two ever need to evolve independently,
 * that is the moment to split the constant, and ADR-009 must then record
 * which rows were written under which version.
 *
 * THIS MODULE OWNS THE NULL CONVENTION
 * Callers pass previousHash as string or null, never as the token itself.
 * null means genesis.
 *
 * undefined is REJECTED rather than treated as genesis: a caller that forgot
 * the field is making a mistake, not making a claim. The empty string is
 * rejected for the same reason - coercing a missing previousHash to the
 * empty string would make a genesis row and a row with an empty
 * previousHash hash identically.
 */

import {
  CANONICAL_VERSION,
  NULL_TOKEN,
  canonicalTimestamp,
} from './canonical-fix';

/** Lowercase SHA-256 hex digest. */
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Rejects the two characters reserved by the envelope grammar.
 *
 * DO NOT DELETE THESE CALLS BECAUSE THEY CANNOT FIRE.
 * That they cannot fire is the point. Every field today is constrained to
 * hex, base-10 digits or ISO-8601, so neither character can appear - but a
 * field added later with a looser value space would make the envelope
 * ambiguous to any parser splitting on | or =, and could let two different
 * rows produce the same preimage. The assertion costs four short string
 * scans per fix and converts that from a silent correctness bug into a loud
 * failure on the first call after the field is added.
 */
function assertNoDelimiter(value: string, field: string): void {
  if (value.indexOf('|') !== -1 || value.indexOf('=') !== -1) {
    throw new Error(
      'Canonical chain field ' + field + ' contains a reserved delimiter: ' +
        value,
    );
  }
}

/**
 * A SHA-256 digest, lowercase hex, exactly 64 characters.
 *
 * Validated rather than assumed: an uppercase digest, or a Buffer stringified
 * the wrong way, is a plausible caller mistake and would produce a different
 * chain hash for the same logical row.
 */
export function canonicalDigest(value: string, field: string): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new Error(
      'Canonical chain field ' + field + ' must be a lowercase 64-character ' +
        'hex SHA-256 digest, received: ' + JSON.stringify(value),
    );
  }
  return value;
}

/**
 * Plain base-10, no padding, no separators, no exponent.
 *
 * String(n) is locale-independent and only switches to exponent notation at
 * 1e21, far above Number.MAX_SAFE_INTEGER, so the safe-integer guard also
 * guarantees positional output.
 */
export function canonicalSequence(value: number): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(
      'sequence must be a safe integer, received: ' + String(value),
    );
  }
  if (value < 0) {
    throw new Error(
      'sequence must be non-negative, received: ' + String(value),
    );
  }
  return String(value);
}

export interface CanonicalChainInput {
  /** null means genesis. undefined is a caller error and throws. */
  previousHash: string | null;
  payloadHash: string;
  sequence: number;
  /**
   * Server receipt time. MUST be the millisecond-truncated transaction clock
   * (date_trunc to milliseconds over now()), not a Node clock.
   *
   * The column is timestamp(3) and PostgreSQL ROUNDS to that precision on
   * store, so an untruncated microsecond value would be hashed as one
   * millisecond and stored as another. canonicalTimestamp will NOT catch
   * this: a sub-millisecond ISO string is silently truncated by the JS Date
   * constructor rather than rejected. Truncation at the source is the only
   * guard.
   */
  receivedAt: Date | string;
}

/**
 * The bytes that the chain hash covers.
 *
 * v1|prev=<64 hex | null>|payload=<64 hex>|seq=<base-10>|rcv=<ISO ms Z>
 *
 * Field order is fixed. No whitespace. UTF-8.
 */
export function canonicalChainEnvelope(input: CanonicalChainInput): string {
  // Stated here rather than left to canonicalDigest, so the contract is
  // visible at the top of the function and the error names the contract
  // instead of reporting a malformed digest. The type already excludes
  // undefined; this catches the untyped or spread-constructed caller.
  if (input.previousHash === undefined) {
    throw new Error(
      'previousHash must be null (genesis) or a 64-character SHA-256 digest.',
    );
  }

  const prev =
    input.previousHash === null
      ? NULL_TOKEN
      : canonicalDigest(input.previousHash, 'previousHash');

  const payload = canonicalDigest(input.payloadHash, 'payloadHash');
  const seq = canonicalSequence(input.sequence);
  const rcv = canonicalTimestamp(input.receivedAt);

  assertNoDelimiter(prev, 'previousHash');
  assertNoDelimiter(payload, 'payloadHash');
  assertNoDelimiter(seq, 'sequence');
  assertNoDelimiter(rcv, 'receivedAt');

  return [
    CANONICAL_VERSION,
    'prev=' + prev,
    'payload=' + payload,
    'seq=' + seq,
    'rcv=' + rcv,
  ].join('|');
}
