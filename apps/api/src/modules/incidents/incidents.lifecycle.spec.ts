import { ConflictException, NotFoundException } from '@nestjs/common';
import { IncidentStatus } from '@prisma/client';
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
    incident: { findUnique: jest.Mock; update: jest.Mock };
  };

  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let accessTokens: { revokeAllForIncident: jest.Mock };
  let timeline: { recordEvent: jest.Mock };
  let service: IncidentsService;

  const INCIDENT_ID = 'incident-1';
  const OWNER_ID = 'user-1';

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      incident: {
        findUnique: jest.fn(),
        update: jest.fn(),
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

    service = new IncidentsService(
      prisma as never,
      accessTokens as never,
      timeline as never,
    );
  });

  function openIncident() {
    tx.incident.findUnique.mockResolvedValue({
      id: INCIDENT_ID,
      userId: OWNER_ID,
      status: IncidentStatus.OPEN,
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
    });

    await expect(service.cancel(INCIDENT_ID, OWNER_ID)).rejects.toThrow(
      ConflictException,
    );

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(accessTokens.revokeAllForIncident).not.toHaveBeenCalled();
    expect(timeline.recordEvent).not.toHaveBeenCalled();
  });
});
