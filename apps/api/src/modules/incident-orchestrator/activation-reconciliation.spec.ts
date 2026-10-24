import { ConflictException } from '@nestjs/common';
import { IncidentOrchestratorService } from './incident-orchestrator.service';
import { IncidentsService } from '../incidents/incidents.service';
import { ActivationMode, ActivationSource, EmergencyTriggerType, TriggerMode } from '../emergency-detection/dto/trigger-request.dto';
import { boundPressedAt } from '../emergency-delivery/activation-policy';

const ACTIVATION = '7a0f9a54-3b8e-4c47-9a39-2f8a6f1c2d11';

function fixture(seen: Record<string, unknown> | null = null) {
  const tx = {
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(async () => ({ facilityId: 'facility-a', membershipState: 'ACTIVE' })) },
    journeySession: { findFirst: jest.fn(async () => null) },
    incident: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'incident-1', status: 'OPEN', createdAt: new Date(), retriggerCount: 0 })),
      update: jest.fn(),
    },
    incidentNotification: { findMany: jest.fn(async () => []) },
    emergencyActivation: {
      findUnique: jest.fn(async () => seen),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)) };
  const timeline = { recordEvent: jest.fn(async () => ({})) };
  const queue = { queueMany: jest.fn(async () => ({})) };
  const tokens = { issue: jest.fn(async () => ({ token: 'test-token' })) };
  const incidents = new IncidentsService(prisma as never, tokens as never, timeline as never, {} as never);
  const service = new IncidentOrchestratorService(
    { evaluate: () => ({ outcome: { shouldActivate: true, isSilent: false } }) } as never,
    {} as never, incidents,
    { listForUser: async () => [{ id: 'contact-1', firstName: 'Test', lastName: 'Recipient', isActive: true, receivesEmergencySms: true, phoneNumber: '+15555550123' }] } as never,
    queue as never, { findById: async () => ({ firstName: 'Test', lastName: 'User', facilityId: 'facility-a' }) } as never,
    timeline as never, prisma as never, tokens as never, {} as never,
  );
  const request = {
    triggerType: EmergencyTriggerType.SOS_BUTTON, mode: TriggerMode.CONFIRMATION, activationMode: ActivationMode.STANDARD,
    activationSource: ActivationSource.MANUAL, userConfirmed: true, activationId: ACTIVATION, pressedAt: new Date(Date.now() - 30_000).toISOString(),
  };
  return { service, request, tx, timeline, queue };
}

describe('one press, many routes', () => {
  it('records the activation with press time, channel and verification on the first arrival', async () => {
    const { service, request, tx, queue } = fixture();
    const result = await service.createCoordinatedIncident('owner-1', request);
    expect(result.status).toBe('INCIDENT_ACTIVATED');
    expect(tx.emergencyActivation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ activationId: ACTIVATION, userId: 'owner-1', incidentId: 'incident-1', firstChannel: 'APP', channels: ['APP'], verification: 'APP_SIGNED_IN', pressedAt: expect.any(Date) }),
    });
    expect(tx.incident.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ deliveryChannel: 'APP', activationId: ACTIVATION, pressedAtStatus: 'PHONE' }) }) });
    expect(queue.queueMany).toHaveBeenCalledTimes(1);
  });

  it('reconciles a repeat of the same press without a new incident or new notifications', async () => {
    const { service, request, tx, queue } = fixture({ id: 'act-1', userId: 'owner-1', incidentId: 'incident-1', channels: ['APP'], incident: { id: 'incident-1', status: 'OPEN', retriggerCount: 0, createdAt: new Date() } });
    const result = await service.createCoordinatedIncident('owner-1', request);
    expect(result).toMatchObject({ status: 'INCIDENT_RETRIGGERED', reconciled: true, notifications: { queued: 0 } });
    expect(tx.incident.create).not.toHaveBeenCalled();
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(queue.queueMany).not.toHaveBeenCalled();
    expect(tx.emergencyActivation.update).not.toHaveBeenCalled();
  });

  it('adds the SMS route to an activation first received over the internet', async () => {
    const { service, request, tx, timeline } = fixture({ id: 'act-1', userId: 'owner-1', incidentId: 'incident-1', channels: ['APP'], incident: { id: 'incident-1', status: 'OPEN', retriggerCount: 0, createdAt: new Date() } });
    await service.createCoordinatedIncident('owner-1', request, { channel: 'SMS', verification: 'SMS_SIGNED' });
    expect(tx.emergencyActivation.update).toHaveBeenCalledWith({ where: { id: 'act-1' }, data: { channels: { push: 'SMS' } } });
    expect(timeline.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ACTIVATION_RECONCILED', payload: expect.objectContaining({ channel: 'SMS', newRoute: true }) }), tx);
  });

  it("refuses another person's activation id", async () => {
    const { service, request } = fixture({ id: 'act-1', userId: 'someone-else', incidentId: 'incident-9', channels: ['APP'], incident: {} });
    await expect(service.createCoordinatedIncident('owner-1', request)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('press time bounds', () => {
  const now = new Date('2026-10-24T03:00:00Z');
  it.each([
    [undefined, null, 'MISSING'],
    ['2026-10-24T02:59:00Z', '2026-10-24T02:59:00.000Z', 'PHONE'],
    ['2026-10-24T03:01:30Z', '2026-10-24T03:01:30.000Z', 'PHONE'],
    ['2026-10-24T03:05:00Z', null, 'OUT_OF_BOUNDS'],
    ['2026-10-22T02:00:00Z', null, 'OUT_OF_BOUNDS'],
  ])('%s', (value, expected, status) => {
    const r = boundPressedAt(value, now);
    expect(r.pressedAt ? r.pressedAt.toISOString() : null).toBe(expected);
    expect(r.pressedAtStatus).toBe(status);
  });
});
