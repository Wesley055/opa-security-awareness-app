import { BadRequestException, ConflictException } from '@nestjs/common';
import { IncidentStatus, JourneySessionEndReason } from '@prisma/client';
import { IncidentsService } from './incidents.service';

describe('IncidentsService legacy reconciliation', () => {
  type TxMock = {
    $executeRaw: jest.Mock;
    incident: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let accessTokens: { revokeAllForIncident: jest.Mock };
  let timeline: { recordEvent: jest.Mock };
  let journeySessions: { endSession: jest.Mock };
  let service: IncidentsService;

  const INCIDENT_ID = 'incident-stale';
  const OWNER_ID = 'user-1';
  const EVIDENCE_ID = 'incident-evidence';
  const SESSION_ID = 'session-1';

  const staleCreatedAt = new Date('2026-08-20T05:43:16.206Z');
  const staleLastTriggeredAt = new Date('2026-08-20T05:43:16.205Z');
  const evidenceCreatedAt = new Date('2026-08-20T18:04:54.799Z');
  const evidenceResolvedAt = new Date('2026-08-20T18:22:29.193Z');

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      incident: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 'another-open' }),
      },
    };

    prisma = {
      $transaction: jest.fn(async (fn: (t: TxMock) => unknown) => fn(tx)),
    };

    accessTokens = {
      revokeAllForIncident: jest.fn().mockResolvedValue(1),
    };

    timeline = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
    };

    journeySessions = {
      endSession: jest.fn().mockResolvedValue({
        session: {},
        alreadyEnded: false,
      }),
    };

    service = new IncidentsService(
      prisma as never,
      accessTokens as never,
      timeline as never,
      journeySessions as never,
    );
  });

  function validEvidence() {
    tx.incident.findUnique
      .mockResolvedValueOnce({
        id: INCIDENT_ID,
        userId: OWNER_ID,
        status: IncidentStatus.OPEN,
        createdAt: staleCreatedAt,
        lastTriggeredAt: staleLastTriggeredAt,
        journeySessionId: SESSION_ID,
      })
      .mockResolvedValueOnce({
        id: EVIDENCE_ID,
        userId: OWNER_ID,
        status: IncidentStatus.RESOLVED,
        createdAt: evidenceCreatedAt,
        resolvedAt: evidenceResolvedAt,
      });

    tx.incident.update.mockResolvedValue({
      id: INCIDENT_ID,
      status: IncidentStatus.CANCELLED,
      resolvedAt: null,
    });
  }

  it('cancels a legacy OPEN duplicate using later RESOLVED evidence', async () => {
    validEvidence();

    const result = await service.reconcileLegacyDuplicate(
      INCIDENT_ID,
      OWNER_ID,
      EVIDENCE_ID,
      staleLastTriggeredAt,
    );

    expect(tx.incident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT_ID },
      data: {
        status: IncidentStatus.CANCELLED,
        resolvedAt: null,
      },
    });

    expect(result.status).toBe(IncidentStatus.CANCELLED);
    expect(result.resolvedAt).toBeNull();
    expect(result.evidenceIncidentId).toBe(EVIDENCE_ID);
    expect(result.evidenceResolvedAt).toEqual(evidenceResolvedAt);
  });

  it('records reconciliation as SYSTEM activity, not a resident MOBILE close', async () => {
    validEvidence();

    await service.reconcileLegacyDuplicate(
      INCIDENT_ID,
      OWNER_ID,
      EVIDENCE_ID,
      staleLastTriggeredAt,
    );

    const event = timeline.recordEvent.mock.calls[0][0];

    expect(event.type).toBe('INCIDENT_CANCELLED');
    expect(event.source).toBe('SYSTEM_RECONCILIATION');
    expect(event.actorUserId).toBeUndefined();
    expect(event.occurredAt).toBeInstanceOf(Date);

    expect(event.payload).toMatchObject({
      previousStatus: IncidentStatus.OPEN,
      newStatus: IncidentStatus.CANCELLED,
      reason: 'LEGACY_DUPLICATE_RECONCILIATION',
      evidenceIncidentId: EVIDENCE_ID,
      evidenceResolvedAt: evidenceResolvedAt.toISOString(),
      revokedTokens: 1,
    });

    expect(timeline.recordEvent.mock.calls[0][1]).toBe(tx);
    expect(accessTokens.revokeAllForIncident).toHaveBeenCalledWith(
      INCIDENT_ID,
      tx,
    );
  });

  it('does not end a shared journey session while another OPEN incident uses it', async () => {
    validEvidence();
    tx.incident.findFirst.mockResolvedValue({ id: 'another-open' });

    const result = await service.reconcileLegacyDuplicate(
      INCIDENT_ID,
      OWNER_ID,
      EVIDENCE_ID,
      staleLastTriggeredAt,
    );

    expect(journeySessions.endSession).not.toHaveBeenCalled();
    expect(result.endedJourneySessionId).toBeNull();
  });

  it('ends the journey session with ADMIN_ENDED when reconciling its final OPEN incident', async () => {
    validEvidence();
    tx.incident.findFirst.mockResolvedValue(null);

    const result = await service.reconcileLegacyDuplicate(
      INCIDENT_ID,
      OWNER_ID,
      EVIDENCE_ID,
      staleLastTriggeredAt,
    );

    expect(journeySessions.endSession).toHaveBeenCalledWith(
      tx,
      OWNER_ID,
      SESSION_ID,
      JourneySessionEndReason.ADMIN_ENDED,
    );

    expect(result.endedJourneySessionId).toBe(SESSION_ID);
  });

  it('rejects evidence that is not a later RESOLVED incident', async () => {
    tx.incident.findUnique
      .mockResolvedValueOnce({
        id: INCIDENT_ID,
        userId: OWNER_ID,
        status: IncidentStatus.OPEN,
        createdAt: staleCreatedAt,
        lastTriggeredAt: staleLastTriggeredAt,
        journeySessionId: SESSION_ID,
      })
      .mockResolvedValueOnce({
        id: EVIDENCE_ID,
        userId: OWNER_ID,
        status: IncidentStatus.OPEN,
        createdAt: evidenceCreatedAt,
        resolvedAt: null,
      });

    await expect(
      service.reconcileLegacyDuplicate(
        INCIDENT_ID,
        OWNER_ID,
        EVIDENCE_ID,
        staleLastTriggeredAt,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(accessTokens.revokeAllForIncident).not.toHaveBeenCalled();
    expect(timeline.recordEvent).not.toHaveBeenCalled();
  });

  it('refuses reconciliation when the incident was retriggered after planning', async () => {
    const retriggeredAt = new Date(
      staleLastTriggeredAt.getTime() + 30_000,
    );

    tx.incident.findUnique.mockResolvedValueOnce({
      id: INCIDENT_ID,
      userId: OWNER_ID,
      status: IncidentStatus.OPEN,
      createdAt: staleCreatedAt,
      lastTriggeredAt: retriggeredAt,
      journeySessionId: SESSION_ID,
    });

    await expect(
      service.reconcileLegacyDuplicate(
        INCIDENT_ID,
        OWNER_ID,
        EVIDENCE_ID,
        staleLastTriggeredAt,
      ),
    ).rejects.toThrow(
      'Incident was retriggered after the reconciliation plan was computed.',
    );

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(accessTokens.revokeAllForIncident).not.toHaveBeenCalled();
    expect(timeline.recordEvent).not.toHaveBeenCalled();
    expect(journeySessions.endSession).not.toHaveBeenCalled();

    // Strong short-circuit proof: evidence was never read.
    expect(tx.incident.findUnique).toHaveBeenCalledTimes(1);
  });

  it('refuses to reconcile an incident that is already terminal', async () => {
    tx.incident.findUnique.mockResolvedValueOnce({
      id: INCIDENT_ID,
      userId: OWNER_ID,
      status: IncidentStatus.RESOLVED,
      createdAt: staleCreatedAt,
      lastTriggeredAt: staleLastTriggeredAt,
      journeySessionId: SESSION_ID,
    });

    await expect(
      service.reconcileLegacyDuplicate(
        INCIDENT_ID,
        OWNER_ID,
        EVIDENCE_ID,
        staleLastTriggeredAt,
      ),
    ).rejects.toThrow(ConflictException);

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(accessTokens.revokeAllForIncident).not.toHaveBeenCalled();
    expect(timeline.recordEvent).not.toHaveBeenCalled();
  });

  it('takes the user advisory lock before the incident class-3 lock', async () => {
    validEvidence();

    await service.reconcileLegacyDuplicate(
      INCIDENT_ID,
      OWNER_ID,
      EVIDENCE_ID,
      staleLastTriggeredAt,
    );

    const first = tx.$executeRaw.mock.calls[0];
    const second = tx.$executeRaw.mock.calls[1];

    if (first === undefined || second === undefined) {
      throw new Error('Expected both reconciliation advisory locks.');
    }

    expect(String(first[0])).not.toContain('pg_advisory_xact_lock(3');
    expect(String(second[0])).toContain('pg_advisory_xact_lock(3');
  });
});