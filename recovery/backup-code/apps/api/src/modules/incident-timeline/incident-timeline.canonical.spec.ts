import { createHash } from 'crypto';
import { IncidentTimelineService } from './incident-timeline.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Payload canonicalisation for the timeline hash chain.
 *
 * The payload column is jsonb, which does not preserve key order. Hashing
 * the payload object directly therefore produced one string at write time
 * and another at verify time, and verifyChain reported a valid chain as
 * broken. These tests pin the property that fixes it.
 *
 * computeHash is private, so the tests reach it through a narrow cast
 * rather than exporting it. The alternative - asserting only through
 * recordEvent - would need a database and would not isolate the property.
 */
describe('IncidentTimelineService payload canonicalisation', () => {
  const service = new IncidentTimelineService({} as unknown as PrismaService);

  const hashOf = (payload: Record<string, unknown>): string =>
    (
      service as unknown as {
        computeHash: (input: {
          incidentId: string;
          sequence: number;
          type: string;
          payload: Record<string, unknown>;
          occurredAt: Date;
          previousHash: string | null;
        }) => string;
      }
    ).computeHash({
      incidentId: 'incident-1',
      sequence: 1,
      type: 'INCIDENT_RESOLVED',
      payload,
      occurredAt: new Date('2026-08-07T10:00:00.000Z'),
      previousHash: null,
    });

  it('hashes the same object identically whatever the key insertion order', () => {
    // The exact reordering PostgreSQL performed on this payload: keys by
    // length, then bytewise.
    const written = {
      previousStatus: 'OPEN',
      newStatus: 'RESOLVED',
      reason: 'USER_SAFE',
      revokedTokens: 2,
    };
    const readBack = {
      reason: 'USER_SAFE',
      newStatus: 'RESOLVED',
      revokedTokens: 2,
      previousStatus: 'OPEN',
    };

    expect(JSON.stringify(written)).not.toBe(JSON.stringify(readBack));
    expect(hashOf(written)).toBe(hashOf(readBack));
  });

  it('sorts keys at every depth, including inside arrays', () => {
    // A shallow sort passes the flat test above and fails here, which is
    // where a real nested payload would break.
    const a = { outer: { b: 1, a: 2 }, list: [{ z: 1, y: 2 }] };
    const b = { list: [{ y: 2, z: 1 }], outer: { a: 2, b: 1 } };

    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(hashOf(a)).toBe(hashOf(b));
  });

  it('treats ARRAY ORDER as data and does not sort it', () => {
    // jsonb preserves array order, so two different orders are two
    // different payloads and must not collide.
    expect(hashOf({ items: [1, 2, 3] })).not.toBe(
      hashOf({ items: [3, 2, 1] }),
    );
  });

  it('distinguishes different values under identical keys', () => {
    expect(hashOf({ newStatus: 'RESOLVED' })).not.toBe(
      hashOf({ newStatus: 'CANCELLED' }),
    );
  });

  it('handles null, nested null and empty structures without throwing', () => {
    // typeof null === 'object' and Object.keys(null) throws, so this is the
    // branch a naive implementation crashes on.
    expect(() =>
      hashOf({ a: null, b: { c: null }, d: [], e: {}, f: [null] }),
    ).not.toThrow();
  });

  it('leaves an EMPTY payload hashing exactly as it did before the fix', () => {
    // COMPATIBILITY. Every caller before the incident lifecycle passed no
    // payload, so all existing events hash {}. Canonicalising {} yields {},
    // so those hashes are unchanged and existing chains still verify. This
    // asserts it against an independently computed digest rather than
    // trusting the reasoning.
    const occurredAt = new Date('2026-08-07T10:00:00.000Z');
    const expected = createHash('sha256')
      .update(
        JSON.stringify({
          incidentId: 'incident-1',
          sequence: 1,
          type: 'INCIDENT_RESOLVED',
          payload: {},
          occurredAt: occurredAt.toISOString(),
          previousHash: null,
        }),
      )
      .digest('hex');

    expect(hashOf({})).toBe(expected);
  });
});
