import { ConflictException, NotFoundException } from '@nestjs/common';
import { IncidentStatus, JourneySessionEndReason } from '@prisma/client';
import { IncidentsService } from './incidents.service';

/**
 * Incident lifecycle transitions.
 *
 * Kept in its own file rather than appended to incidents.service.spec.ts so
 * the existing create/list coverage is untouched.
 */
describe('IncidentsService lifecycle', () => {
  type TxMock = {
    $executeRaw: jest.Mock;
    incident: { findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
  };

  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let accessTokens: { revokeAllForIncident: jest.Mock };
  let timeline: { recordEvent: jest.Mock };
  let journeySessions: { endSession: jest.Mock };
  let service: IncidentsService;

  const INCIDENT_ID = 'incident-1';
  const OWNER_ID = 'user-1';

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      incident: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    prisma = {
      // Runs the callback with the mock transaction client, so everything the
      // transition does is observable on ONE object - which is what lets the
      // atomicity assertions below mean something.
      $transaction: jest.fn(async (fn: (t: TxMock) => unknown) => fn(tx)),
    };

    accessTokens = { revokeAllForIncident: jest.fn().mockResolvedValue(2) };
    timeline = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    journeySessions = { endSession: jest.fn().mockResolvedValue(null) };

    service = new IncidentsService(
      prisma as never,
      accessTokens as never,
      timeline as never,
      journeySessions as never,
    );
  });

  function openIncident() {
    tx.incident.findUnique.mockResolvedValue({
      id: INCIDENT_ID,
      userId: OWNER_ID,
      status: IncidentStatus.OPEN,
      // Explicitly null, not omitted. close() branches on this, and an
      // undefined from a mock would take a path a real Prisma row never can.
      journeySessionId: null,
    });
  }

  it('resolves an open incident, sets resolvedAt and revokes its tokens', async () => {
    openIncident();
    tx.incident.update.mockResolvedValue({
      id: INCIDENT_ID,
      status: IncidentStatus.RESOLVED,
      resolvedAt: new Date('2026-08-07T10:00:00.000Z'),
    });

    const result = await service.resolve(INCIDENT_ID, OWNER_ID, {
      reason: 'USER_SAFE',
    });

    const updateArgs = tx.incident.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe(IncidentStatus.RESOLVED);
    expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);

    expect(accessTokens.revokeAllForIncident).toHaveBeenCalledWith(
      INCIDENT_ID,
      tx,
    );
    expect(result.revokedTokens).toBe(2);
  });

  it('cancels an open incident and leaves resolvedAt NULL', async () => {
    openIncident();
    tx.incident.update.mockResolvedValue({
      id: INCIDENT_ID,
      status: IncidentStatus.CANCELLED,
      resolvedAt: null,
    });

    await service.cancel(INCIDENT_ID, OWNER_ID);

    const updateArgs = tx.incident.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe(IncidentStatus.CANCELLED);
    // resolvedAt means RESOLVED and nothing else. A cancelled incident that
    // carried a resolvedAt would be read as resolved by anything filtering on
    // that column.
    expect(updateArgs.data.resolvedAt).toBeNull();
  });

  it('writes the timeline event INSIDE the caller transaction', async () => {
    openIncident();
    tx.incident.update.mockResolvedValue({
      id: INCIDENT_ID,
      status: IncidentStatus.RESOLVED,
      resolvedAt: new Date(),
    });

    await service.resolve(INCIDENT_ID, OWNER_ID, { reason: 'USER_SAFE' });

    // The second argument is the transaction client. Without it the event
    // would commit independently of the status change, and a crash between
    // them would leave an incident closed with no record of the transition.
    expect(timeline.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: INCIDENT_ID,
        type: 'INCIDENT_RESOLVED',
        source: 'MOBILE',
        actorUserId: OWNER_ID,
        payload: expect.objectContaining({
          previousStatus: IncidentStatus.OPEN,
          newStatus: IncidentStatus.RESOLVED,
          reason: 'USER_SAFE',
        }),
      }),
      tx,
    );
  });

  it('uses ONE timestamp for the status change and the timeline event', async () => {
    openIncident();
    tx.incident.update.mockResolvedValue({
      id: INCIDENT_ID,
      status: IncidentStatus.RESOLVED,
      resolvedAt: new Date(),
    });

    await service.resolve(INCIDENT_ID, OWNER_ID);

    const resolvedAt = tx.incident.update.mock.calls[0][0].data
      .resolvedAt as Date;
    const occurredAt = timeline.recordEvent.mock.calls[0][0]
      .occurredAt as Date;

    expect(occurredAt.getTime()).toBe(resolvedAt.getTime());
  });

  it('omits reason from the payload when none is given', async () => {
    openIncident();
    tx.incident.update.mockResolvedValue({
      id: INCIDENT_ID,
      status: IncidentStatus.CANCELLED,
      resolvedAt: null,
    });

    await service.cancel(INCIDENT_ID, OWNER_ID);

    const payload = timeline.recordEvent.mock.calls[0][0].payload as Record<
      string,
      unknown
    >;
    expect('reason' in payload).toBe(false);
  });

  it('takes the incident lifecycle advisory lock before reading status', async () => {
    openIncident();
    tx.incident.update.mockResolvedValue({
      id: INCIDENT_ID,
      status: IncidentStatus.RESOLVED,
      resolvedAt: new Date(),
    });

    await service.resolve(INCIDENT_ID, OWNER_ID);

    // Order, not merely presence: reading the status before the lock is held
    // would let two concurrent closes both see OPEN.
    //
    // invocationCallOrder[0] is `number | undefined` under
    // noUncheckedIndexedAccess. Guarded explicitly rather than asserted with
    // `!` - a missing entry means the call never happened, which IS the
    // failure this test exists to catch, and it should say so rather than
    // produce an `undefined < 1` comparison.
    // Index 0 is now the USER lock and index 1 the incident lock; both
    // precede the read, so the first is still the right one to compare.
    const lockOrder = tx.$executeRaw.mock.invocationCallOrder[0];
    const readOrder = tx.incident.findUnique.mock.invocationCallOrder[0];

    if (lockOrder === undefined) {
      throw new Error('The advisory lock was never taken.');
    }
    if (readOrder === undefined) {
      throw new Error('The incident status was never read.');
    }

    expect(lockOrder).toBeLessThan(readOrder);
  });

  it('refuses a non-owner with the SAME 404 as a missing incident', async () => {
    tx.incident.findUnique.mockResolvedValue({
      id: INCIDENT_ID,
      userId: 'someone-else',
      status: IncidentStatus.OPEN,
    });

    await expect(service.resolve(INCIDENT_ID, OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );

    tx.incident.findUnique.mockResolvedValue(null);

    await expect(service.resolve(INCIDENT_ID, OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );

    // Neither path may write anything - a rejected close must not revoke
    // tokens or append to the timeline.
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(accessTokens.revokeAllForIncident).not.toHaveBeenCalled();
    expect(timeline.recordEvent).not.toHaveBeenCalled();
  });

  it('refuses to close an incident that is already closed', async () => {
    tx.incident.findUnique.mockResolvedValue({
      id: INCIDENT_ID,
      userId: OWNER_ID,
      status: IncidentStatus.RESOLVED,
      journeySessionId: null,
    });

    await expect(service.cancel(INCIDENT_ID, OWNER_ID)).rejects.toThrow(
      ConflictException,
    );

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(accessTokens.revokeAllForIncident).not.toHaveBeenCalled();
    expect(timeline.recordEvent).not.toHaveBeenCalled();
    expect(journeySessions.endSession).not.toHaveBeenCalled();
  });
});
describe('IncidentsService lifecycle - journey session', () => {
  type TxMock = {
    $executeRaw: jest.Mock;
    incident: { findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
  };

  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let accessTokens: { revokeAllForIncident: jest.Mock };
  let timeline: { recordEvent: jest.Mock };
  let journeySessions: { endSession: jest.Mock };
  let service: IncidentsService;

  const INCIDENT_ID = 'incident-1';
  const OWNER_ID = 'user-1';
  const SESSION_ID = 'session-1';

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      incident: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: INCIDENT_ID,
          status: IncidentStatus.RESOLVED,
          resolvedAt: new Date(),
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    prisma = {
      $transaction: jest.fn(async (fn: (t: TxMock) => unknown) => fn(tx)),
    };
    accessTokens = { revokeAllForIncident: jest.fn().mockResolvedValue(0) };
    timeline = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    journeySessions = {
      endSession: jest
        .fn()
        .mockResolvedValue({ session: {}, alreadyEnded: false }),
    };

    service = new IncidentsService(
      prisma as never,
      accessTokens as never,
      timeline as never,
      journeySessions as never,
    );
  });

  const openIncident = (journeySessionId: string | null) =>
    tx.incident.findUnique.mockResolvedValue({
      id: INCIDENT_ID,
      userId: OWNER_ID,
      status: IncidentStatus.OPEN,
      journeySessionId,
    });

  it('ends the linked session when no other OPEN incident uses it', async () => {
    openIncident(SESSION_ID);

    const result = await service.resolve(INCIDENT_ID, OWNER_ID);

    expect(journeySessions.endSession).toHaveBeenCalledWith(
      tx,
      OWNER_ID,
      SESSION_ID,
      JourneySessionEndReason.INCIDENT_RESOLVED,
    );
    expect(result.endedJourneySessionId).toBe(SESSION_ID);
  });

  it('DOES NOT end a session another OPEN incident is still using', async () => {
    // The case that matters most. resolveForActivation returns any active
    // session for the user, so one session can serve several incidents.
    // Ending it here would stop telemetry for an emergency still in progress.
    openIncident(SESSION_ID);
    tx.incident.findFirst.mockResolvedValue({ id: 'incident-2' });

    const result = await service.resolve(INCIDENT_ID, OWNER_ID);

    expect(journeySessions.endSession).not.toHaveBeenCalled();
    expect(result.endedJourneySessionId).toBeNull();

    // The query must EXCLUDE the incident being closed, or it would always
    // find itself and never end anything.
    const where = tx.incident.findFirst.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: INCIDENT_ID });
    expect(where.status).toBe(IncidentStatus.OPEN);
    expect(where.journeySessionId).toBe(SESSION_ID);
  });

  it('uses USER_ENDED, not INCIDENT_RESOLVED, when the incident is cancelled', async () => {
    openIncident(SESSION_ID);
    tx.incident.update.mockResolvedValue({
      id: INCIDENT_ID,
      status: IncidentStatus.CANCELLED,
      resolvedAt: null,
    });

    await service.cancel(INCIDENT_ID, OWNER_ID);

    expect(journeySessions.endSession).toHaveBeenCalledWith(
      tx,
      OWNER_ID,
      SESSION_ID,
      JourneySessionEndReason.USER_ENDED,
    );
  });

  it('does nothing about sessions when the incident has none', async () => {
    openIncident(null);

    const result = await service.resolve(INCIDENT_ID, OWNER_ID);

    expect(tx.incident.findFirst).not.toHaveBeenCalled();
    expect(journeySessions.endSession).not.toHaveBeenCalled();
    expect(result.endedJourneySessionId).toBeNull();
  });

  it('does not report an already-ENDED session as newly ended', async () => {
    openIncident(SESSION_ID);
    journeySessions.endSession.mockResolvedValue({
      session: {},
      alreadyEnded: true,
    });

    const result = await service.resolve(INCIDENT_ID, OWNER_ID);

    expect(result.endedJourneySessionId).toBeNull();
  });

  it('takes the USER lock before the incident lock', async () => {
    // endSession takes user -> classid 2, the orchestrator takes user ->
    // classid 3. Taking 3 first here would invert that order against both.
    openIncident(SESSION_ID);

    await service.resolve(INCIDENT_ID, OWNER_ID);

    const first = tx.$executeRaw.mock.calls[0];
    const second = tx.$executeRaw.mock.calls[1];
    if (first === undefined || second === undefined) {
      throw new Error('Expected two advisory locks to be taken.');
    }

    // Tagged-template call: the raw strings array is the first argument.
    const firstSql = String(first[0]);
    const secondSql = String(second[0]);

    expect(firstSql).not.toContain('pg_advisory_xact_lock(3');
    expect(secondSql).toContain('pg_advisory_xact_lock(3');
  });
});

