import { IncidentOrchestratorService } from './incident-orchestrator.service';
import { IncidentsService } from '../incidents/incidents.service';
import { ActivationMode, ActivationSource, EmergencyTriggerType, TriggerMode } from '../emergency-detection/dto/trigger-request.dto';

function fixture(mode: ActivationMode, recent: Record<string, unknown> | null = null) {
  const tx = {
    $executeRaw: jest.fn(), user: { findUnique: jest.fn(async () => ({ facilityId: 'facility-a' })) },
    journeySession: { findFirst: jest.fn(async () => null) },
    incident: {
      findFirst: jest.fn(async () => recent),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'open-1', status: 'OPEN', createdAt: new Date() })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...recent, ...data, id: 'open-1', createdAt: new Date(), retriggerCount: 1 })),
    },
    incidentNotification: { findMany: jest.fn(async () => [{ contactId: 'contact-1', channel: 'SMS' }, { contactId: 'contact-1', channel: 'WHATSAPP' }]) },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)) };
  const timeline = { recordEvent: jest.fn(async () => ({})) };
  const queue = { queueMany: jest.fn(async () => ({})) };
  const tokens = { issue: jest.fn(async () => ({ token: 'test-token' })) };
  const incidents = new IncidentsService(prisma as never, tokens as never, timeline as never, {} as never);
  const service = new IncidentOrchestratorService(
    { evaluate: () => ({ outcome: { shouldActivate: true, isSilent: mode === ActivationMode.SILENT } }) } as never,
    {} as never, incidents,
    { listForUser: async () => [{ id: 'contact-1', firstName: 'Test', lastName: 'Recipient', isActive: true, receivesEmergencySms: true, phoneNumber: '+15555550123' }] } as never,
    queue as never, { findById: async () => ({ firstName: 'Test', lastName: 'User', facilityId: 'facility-a' }) } as never,
    timeline as never, prisma as never, tokens as never, {} as never,
  );
  const request = { triggerType: EmergencyTriggerType.SOS_BUTTON, mode: TriggerMode.CONFIRMATION, activationMode: mode, activationSource: ActivationSource.MANUAL, userConfirmed: true };
  return { service, request, tx, timeline, queue };
}
describe('Silent SOS authoritative lifecycle', () => {
  it.each([ActivationMode.STANDARD, ActivationMode.SILENT])('creates the same OPEN SOS with atomic provenance and unchanged recipients in %s', async mode => {
    const { service, request, tx, timeline, queue } = fixture(mode);
    const result = await service.createCoordinatedIncident('owner-1', request);
    expect(result.status).toBe('INCIDENT_ACTIVATED');
    expect(result.incident).toMatchObject({ id: 'open-1', status: 'OPEN', trigger: 'SOS_BUTTON', facilityId: 'facility-a', userId: 'owner-1', metadata: { activationMode: mode, activationSource: 'MANUAL', presentationMode: mode } });
    expect(timeline.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ACTIVATION_RECORDED', actorUserId: 'owner-1', payload: { activationMode: mode, activationSource: 'MANUAL', retrigger: false } }), tx);
    expect(queue.queueMany).toHaveBeenCalledWith(tx, expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ contactId: 'contact-1', channel: 'SMS', status: 'QUEUED' })]) }));
    expect(JSON.stringify(queue.queueMany.mock.calls)).not.toContain('SILENT');
  });
  it('reuses an OPEN incident without duplicate fanout and retains quiet presentation on retrigger', async () => {
    const { service, request, tx, timeline, queue } = fixture(ActivationMode.STANDARD, { id: 'open-1', facilityId: 'facility-a', metadata: { activationMode: 'SILENT', presentationMode: 'SILENT' }, createdAt: new Date() });
    const result = await service.createCoordinatedIncident('owner-1', request);
    expect(result.status).toBe('INCIDENT_RETRIGGERED');
    expect(tx.incident.create).not.toHaveBeenCalled();
    expect(queue.queueMany).not.toHaveBeenCalled();
    expect(result.incident?.metadata).toMatchObject({ activationMode: 'SILENT', lastActivationMode: 'STANDARD', presentationMode: 'SILENT' });
    expect(timeline.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ACTIVATION_RECORDED', payload: expect.objectContaining({ activationMode: 'STANDARD', retrigger: true }) }), tx);
  });
  it('does not return success when atomic audit persistence fails', async () => {
    const { service, request, timeline } = fixture(ActivationMode.SILENT);
    timeline.recordEvent.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.createCoordinatedIncident('owner-1', request)).rejects.toThrow('audit unavailable');
  });
});
