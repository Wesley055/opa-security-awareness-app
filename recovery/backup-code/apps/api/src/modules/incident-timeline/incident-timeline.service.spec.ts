import { IncidentTimelineService } from './incident-timeline.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Constructed directly rather than through Test.createTestingModule:
 * jest.config.ts declares no setupFiles, so reflect-metadata is not loaded
 * globally and a Nest testing module cannot read decorated constructor
 * metadata here. Same reason recorded in provider-confidence.validator.spec.ts.
 *
 * These tests deliberately do NOT recompute hashes independently. The chain is
 * built by calling recordEvent, and verifyChain is then run over the service's
 * own output. A spec that reimplemented computeHash would be a second
 * implementation of the chain agreeing with itself - the duplication
 * journey-session.service.ts warns against for the location chain.
 *
 * What is pinned here:
 *   - the lock is taken BEFORE the prior-event read, and the read before the
 *     insert. Order is the correctness property, not the mere presence of a
 *     lock call.
 *   - the lock uses classid 3, is keyed by incidentId, and passes the id as a
 *     bound parameter rather than interpolating it into the SQL text.
 *   - verifyChain accepts an intact chain, and rejects BOTH failure modes it
 *     distinguishes: altered content, and broken linkage.
 */

interface TimelineRow {
  id: string;
  incidentId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  source: string;
  actorUserId?: string;
  correlationId?: string;
  occurredAt: Date;
  previousHash: string | null;
  hash: string;
}

interface RawCall {
  sql: string;
  values: unknown[];
}

/**
 * noUncheckedIndexedAccess is on, so an index read is T | undefined. These
 * helpers fail loudly rather than letting a spec assert against undefined.
 */
function rowAt(rows: TimelineRow[], index: number): TimelineRow {
  const row = rows[index];
  if (row === undefined) {
    throw new Error('spec: expected a timeline row at index ' + String(index));
  }
  return row;
}

function rawAt(calls: RawCall[], index: number): RawCall {
  const call = calls[index];
  if (call === undefined) {
    throw new Error('spec: expected a raw statement at index ' + String(index));
  }
  return call;
}

function createPrismaFake() {
  const rows: TimelineRow[] = [];
  const calls: string[] = [];
  const raw: RawCall[] = [];
  let nextId = 1;

  const events = {
    findFirst: (args: { where: { incidentId: string } }) => {
      calls.push('findFirst');
      const matching = rows
        .filter((row) => row.incidentId === args.where.incidentId)
        .sort((a, b) => b.sequence - a.sequence);
      const latest = matching[0];
      return Promise.resolve(latest ?? null);
    },
    create: (args: { data: Omit<TimelineRow, 'id'> }) => {
      calls.push('create');
      const row: TimelineRow = Object.assign(
        { id: 'evt-' + String(nextId) },
        args.data,
      );
      nextId += 1;
      rows.push(row);
      return Promise.resolve(row);
    },
    findMany: (args: { where: { incidentId: string } }) => {
      calls.push('findMany');
      return Promise.resolve(
        rows
          .filter((row) => row.incidentId === args.where.incidentId)
          .sort((a, b) => a.sequence - b.sequence),
      );
    },
  };

  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push('$executeRaw');
      raw.push({ sql: strings.join('?'), values });
      return Promise.resolve(1);
    },
    incidentTimelineEvent: events,
  };

  const prisma = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    incidentTimelineEvent: events,
  };

  return { prisma, rows, calls, raw };
}

describe('IncidentTimelineService', () => {
  const INCIDENT = 'incident-aaa';
  const OTHER = 'incident-bbb';

  const build = () => {
    const fake = createPrismaFake();
    const service = new IncidentTimelineService(
      fake.prisma as unknown as PrismaService,
    );
    return { fake, service };
  };

  const append = (
    service: IncidentTimelineService,
    incidentId: string,
    type: string,
    payload: Record<string, unknown>,
    second: number,
  ) =>
    service.recordEvent({
      incidentId,
      type,
      payload,
      source: 'SPEC',
      occurredAt: new Date(Date.UTC(2026, 6, 30, 0, 0, second)),
    });

  it('takes the lock before reading the prior event, and reads before inserting', async () => {
    const { fake, service } = build();

    await append(service, INCIDENT, 'SOS_ACTIVATED', { a: 1 }, 1);

    // Order is the property. A lock taken after the read would satisfy a
    // presence assertion and prevent nothing.
    expect(fake.calls).toEqual(['$executeRaw', 'findFirst', 'create']);
  });

  it('locks on classid 3, keyed by incident, with the id bound not interpolated', async () => {
    const { fake, service } = build();

    await append(service, INCIDENT, 'SOS_ACTIVATED', {}, 1);

    expect(fake.raw).toHaveLength(1);
    const statement = rawAt(fake.raw, 0);
    expect(statement.sql).toContain('pg_advisory_xact_lock(3, hashtext(');
    expect(statement.values).toEqual([INCIDENT]);
    expect(statement.sql).not.toContain(INCIDENT);
  });

  it('assigns consecutive sequences and links each event to its predecessor', async () => {
    const { fake, service } = build();

    await append(service, INCIDENT, 'SOS_ACTIVATED', { step: 1 }, 1);
    await append(service, INCIDENT, 'EVIDENCE_ADDED', { step: 2 }, 2);
    await append(service, INCIDENT, 'SOS_RETRIGGERED', { step: 3 }, 3);

    expect(fake.rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(rowAt(fake.rows, 0).previousHash).toBeNull();
    expect(rowAt(fake.rows, 1).previousHash).toBe(rowAt(fake.rows, 0).hash);
    expect(rowAt(fake.rows, 2).previousHash).toBe(rowAt(fake.rows, 1).hash);

    await expect(service.verifyChain(INCIDENT)).resolves.toEqual({ valid: true });
  });

  it('detects an altered payload and names the broken sequence', async () => {
    const { fake, service } = build();

    await append(service, INCIDENT, 'SOS_ACTIVATED', { step: 1 }, 1);
    await append(service, INCIDENT, 'EVIDENCE_ADDED', { step: 2 }, 2);
    await append(service, INCIDENT, 'SOS_RETRIGGERED', { step: 3 }, 3);

    // Tamper with stored content, leaving every hash and link untouched. This
    // is the case the chain exists to catch.
    rowAt(fake.rows, 1).payload = { step: 999 };

    const result = await service.verifyChain(INCIDENT);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(2);
  });

  it('detects a broken link, a different failure from altered content', async () => {
    const { fake, service } = build();

    await append(service, INCIDENT, 'SOS_ACTIVATED', { step: 1 }, 1);
    await append(service, INCIDENT, 'EVIDENCE_ADDED', { step: 2 }, 2);
    await append(service, INCIDENT, 'SOS_RETRIGGERED', { step: 3 }, 3);

    // Repoint one event at a predecessor that is not its own. Content is
    // untouched; only the linkage lies. verifyChain checks linkage first.
    rowAt(fake.rows, 2).previousHash = '0'.repeat(64);

    const result = await service.verifyChain(INCIDENT);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(3);
  });

  it('numbers each incident independently', async () => {
    const { fake, service } = build();

    await append(service, INCIDENT, 'SOS_ACTIVATED', {}, 1);
    await append(service, OTHER, 'SOS_ACTIVATED', {}, 2);

    expect(fake.rows.map((row) => [row.incidentId, row.sequence])).toEqual([
      [INCIDENT, 1],
      [OTHER, 1],
    ]);
  });

  it('treats an empty timeline as valid', async () => {
    const { service } = build();

    await expect(service.verifyChain('incident-none')).resolves.toEqual({
      valid: true,
    });
  });

  describe('legacy structural verification', () => {
    it('accepts an intact stored chain without recomputing historical content hashes', async () => {
      const { fake, service } = build();

      fake.rows.push(
        {
          id: 'evt-legacy-1',
          incidentId: INCIDENT,
          sequence: 1,
          type: 'INCIDENT_CREATED',
          payload: { historical: 'jsonb-order-not-recoverable' },
          source: 'SPEC',
          occurredAt: new Date('2026-08-06T13:00:00.000Z'),
          previousHash: null,
          hash: 'historical-hash-1',
        },
        {
          id: 'evt-legacy-2',
          incidentId: INCIDENT,
          sequence: 2,
          type: 'LOCATION_ATTACHED',
          payload: {},
          source: 'SPEC',
          occurredAt: new Date('2026-08-06T13:01:00.000Z'),
          previousHash: 'historical-hash-1',
          hash: 'historical-hash-2',
        },
      );

      await expect(
        service.verifyStructuralChain(INCIDENT),
      ).resolves.toEqual({ valid: true });
    });

    it('rejects a broken predecessor link at the correct sequence', async () => {
      const { fake, service } = build();

      fake.rows.push(
        {
          id: 'evt-legacy-1',
          incidentId: INCIDENT,
          sequence: 1,
          type: 'INCIDENT_CREATED',
          payload: {},
          source: 'SPEC',
          occurredAt: new Date('2026-08-06T13:00:00.000Z'),
          previousHash: null,
          hash: 'historical-hash-1',
        },
        {
          id: 'evt-legacy-2',
          incidentId: INCIDENT,
          sequence: 2,
          type: 'LOCATION_ATTACHED',
          payload: {},
          source: 'SPEC',
          occurredAt: new Date('2026-08-06T13:01:00.000Z'),
          previousHash: 'WRONG',
          hash: 'historical-hash-2',
        },
      );

      await expect(
        service.verifyStructuralChain(INCIDENT),
      ).resolves.toEqual({
        valid: false,
        brokenAtSequence: 2,
      });
    });

    it('rejects a sequence gap', async () => {
      const { fake, service } = build();

      fake.rows.push(
        {
          id: 'evt-legacy-1',
          incidentId: INCIDENT,
          sequence: 1,
          type: 'INCIDENT_CREATED',
          payload: {},
          source: 'SPEC',
          occurredAt: new Date('2026-08-06T13:00:00.000Z'),
          previousHash: null,
          hash: 'historical-hash-1',
        },
        {
          id: 'evt-legacy-3',
          incidentId: INCIDENT,
          sequence: 3,
          type: 'LOCATION_ATTACHED',
          payload: {},
          source: 'SPEC',
          occurredAt: new Date('2026-08-06T13:01:00.000Z'),
          previousHash: 'historical-hash-1',
          hash: 'historical-hash-3',
        },
      );

      await expect(
        service.verifyStructuralChain(INCIDENT),
      ).resolves.toEqual({
        valid: false,
        brokenAtSequence: 3,
      });
    });

    it('accepts a newly written canonical tail on a structurally intact legacy chain', async () => {
      const { fake, service } = build();

      fake.rows.push({
        id: 'evt-legacy-1',
        incidentId: INCIDENT,
        sequence: 1,
        type: 'INCIDENT_CREATED',
        payload: { historical: true },
        source: 'SPEC',
        occurredAt: new Date('2026-08-06T13:00:00.000Z'),
        previousHash: null,
        hash: 'historical-hash-1',
      });

      await append(
        service,
        INCIDENT,
        'INCIDENT_CANCELLED',
        {
          reason: 'LEGACY_DUPLICATE_RECONCILIATION',
          previousStatus: 'OPEN',
          newStatus: 'CANCELLED',
        },
        23,
      );

      await expect(
        service.verifyTailEvent(INCIDENT),
      ).resolves.toEqual({ valid: true });
    });

    it('rejects an altered current tail hash', async () => {
      const { fake, service } = build();

      fake.rows.push({
        id: 'evt-legacy-1',
        incidentId: INCIDENT,
        sequence: 1,
        type: 'INCIDENT_CREATED',
        payload: { historical: true },
        source: 'SPEC',
        occurredAt: new Date('2026-08-06T13:00:00.000Z'),
        previousHash: null,
        hash: 'historical-hash-1',
      });

      await append(
        service,
        INCIDENT,
        'INCIDENT_CANCELLED',
        {
          reason: 'LEGACY_DUPLICATE_RECONCILIATION',
        },
        23,
      );

      rowAt(fake.rows, 1).hash = 'ALTERED';

      await expect(
        service.verifyTailEvent(INCIDENT),
      ).resolves.toEqual({
        valid: false,
        brokenAtSequence: 2,
      });
    });

    it('rejects a newly appended tail whose predecessor link was altered', async () => {
      const { fake, service } = build();

      fake.rows.push({
        id: 'evt-legacy-1',
        incidentId: INCIDENT,
        sequence: 1,
        type: 'INCIDENT_CREATED',
        payload: {},
        source: 'SPEC',
        occurredAt: new Date('2026-08-06T13:00:00.000Z'),
        previousHash: null,
        hash: 'historical-hash-1',
      });

      await append(
        service,
        INCIDENT,
        'INCIDENT_CANCELLED',
        {
          reason: 'LEGACY_DUPLICATE_RECONCILIATION',
        },
        23,
      );

      rowAt(fake.rows, 1).previousHash = 'WRONG';

      await expect(
        service.verifyTailEvent(INCIDENT),
      ).resolves.toEqual({
        valid: false,
        brokenAtSequence: 2,
      });
    });
  });
});
