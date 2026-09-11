import { ProfileProvider } from "../../src/modules/emergency-detection/providers/profile.provider";
import { VoiceProvider } from "../../src/modules/emergency-detection/providers/voice.provider";
import { TriggerProvider } from "../../src/modules/emergency-detection/providers/trigger.provider";
import { LanguageProvider } from "../../src/modules/emergency-detection/providers/language.provider";
import { ConfidenceProvider } from "../../src/modules/emergency-detection/providers/confidence.provider";
import { SilentProvider } from "../../src/modules/emergency-detection/providers/silent.provider";
import { randomUUID } from 'node:crypto';
import { prismaTest as db } from './prisma-test-client';
import { createUser } from './fixtures';
import { JourneyIngestionService } from '../../src/modules/journey/journey-ingestion.service';
import { JourneySessionService } from '../../src/modules/journey/journey-session.service';
import { SafeWalkService } from '../../src/modules/journey/safewalk.service';
import { SafeWalkGuardianService } from '../../src/modules/journey/safewalk-guardian.service';
import { SafeWalkEscalationService } from '../../src/modules/journey/safewalk-escalation.service';
import { SafeWalkNotificationWorker } from '../../src/modules/journey/safewalk-notification.worker';
import { ProtectedSnapshotsService } from '../../src/modules/protected-identity/protected-snapshots.service';
import { DeliveryLedgerService } from '../../src/modules/notifications/delivery-ledger.service';
import { deadlines } from '../../src/modules/journey/safewalk-policy';
import { IncidentOrchestratorService } from '../../src/modules/incident-orchestrator/incident-orchestrator.service';
import { IncidentsService } from '../../src/modules/incidents/incidents.service';
import { IncidentAccessTokenService } from '../../src/modules/incident-access/incident-access-token.service';
import { EmergencyDetectionService } from '../../src/modules/emergency-detection/emergency-detection.service';
import { EmergencyTriggerType, TriggerMode } from '../../src/modules/emergency-detection/dto/trigger-request.dto';
import { ProtectedIdentityService } from '../../src/modules/protected-identity/protected-identity.service';
import { LocalIdentityCrypto } from '../../src/modules/protected-identity/identity-crypto';

const journeys = new JourneySessionService();
const api = new JourneyIngestionService(db as never, journeys, {} as never);
const ownerApi = new SafeWalkService(db as never, journeys);
const guardians = new SafeWalkGuardianService(db as never);
const snapshots = new ProtectedSnapshotsService(db as never, {} as never);
const ledger = new DeliveryLedgerService(db as never);

describe('SafeWalk integrated outbox and lifecycle', () => {
  function orchestrator() {
    const tokens = new IncidentAccessTokenService(db as never);
    const timeline = { recordEvent: jest.fn().mockResolvedValue({}) };
    return new IncidentOrchestratorService(new EmergencyDetectionService(new ProfileProvider(), new VoiceProvider(), new TriggerProvider(), new LanguageProvider(), new ConfidenceProvider(), new SilentProvider()), {} as never, new IncidentsService(db as never, tokens, timeline as never, journeys), { listForUser: async () => [] } as never, { queueMany: async () => ({ count: 0 }) } as never, { findById: (id: string) => db.user.findUnique({ where: { id } }) } as never, timeline as never, db as never, tokens, journeys);
  }

  it('links explicit locationless emergency once with auditable provenance under concurrent requests', async () => {
    const owner = await createUser();
    const session = await db.journeySession.create({ data: { userId: owner.id, purpose: 'SAFEWALK' } });
    const sos = orchestrator();
    const request = { triggerType: EmergencyTriggerType.SOS_BUTTON, mode: TriggerMode.CONFIRMATION, userConfirmed: true, safeWalkSessionId: session.id };
    const results = await Promise.all(Array.from({ length: 4 }, () => sos.createCoordinatedIncident(owner.id, request)));
    expect(new Set(results.map(r => r.incident?.id)).size).toBe(1);
    const incident = await db.incident.findFirstOrThrow({ where: { userId: owner.id } });
    expect(incident.journeySessionId).toBe(session.id);
    expect(incident.latitude).toBeNull();
    const saved = await db.journeySession.findUniqueOrThrow({ where: { id: session.id } });
    expect(saved.safeWalkEmergencyIncidentId).toBe(incident.id);
    expect(saved.safeWalkEmergencyAt).not.toBeNull();
    expect(await db.safeWalkAudit.count({ where: { sessionId: session.id, kind: 'EMERGENCY_AUTHORIZED' } })).toBe(1);
  });

  it('serializes completion against explicit emergency without ending active emergency tracking', async () => {
    const owner = await createUser();
    const session = await db.journeySession.create({ data: { userId: owner.id, purpose: 'SAFEWALK' } });
    const results = await Promise.allSettled([ownerApi.confirm(owner.id, session.id, 'ARRIVAL'), orchestrator().createCoordinatedIncident(owner.id, { triggerType: EmergencyTriggerType.SOS_BUTTON, mode: TriggerMode.CONFIRMATION, userConfirmed: true, safeWalkSessionId: session.id })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const saved = await db.journeySession.findUniqueOrThrow({ where: { id: session.id } });
    if (saved.safeWalkEmergencyIncidentId) { expect(saved.status).not.toBe('ENDED'); expect(saved.arrivalConfirmedAt).toBeNull(); }
    else { expect(saved.status).toBe('ENDED'); expect(await db.incident.count()).toBe(0); }
  });

  it('replays a create key after completion without starting a second journey', async () => {
    const owner = await createUser();
    const plan = { purpose: 'SAFEWALK' as const, destinationLabel: 'Private destination', destinationLatitude: 6.5, destinationLongitude: 3.4, expectedArrivalAt: new Date(Date.now() + 600_000).toISOString(), safeWalkCreateKey: randomUUID() };
    const results = await Promise.all(Array.from({ length: 6 }, () => api.startSession(owner.id, plan)));
    expect(new Set(results.map(r => r.sessionId)).size).toBe(1);
    const id = results[0]!.sessionId;
    await Promise.all([ownerApi.confirm(owner.id, id, 'ARRIVAL'), ownerApi.confirm(owner.id, id, 'ARRIVAL')]);
    expect((await api.startSession(owner.id, plan)).status).toBe('ENDED');
    expect(await db.journeySession.count()).toBe(1);
    expect(await db.safeWalkAudit.count({ where: { sessionId: id, kind: 'STARTED' } })).toBe(1);
    expect(await db.incident.count()).toBe(0);
  });

  it('scopes create replay keys and creation audits to each owner', async () => {
    const owners = await Promise.all([createUser(), createUser()]);
    const plan = { purpose: 'SAFEWALK' as const, destinationLabel: 'Home', destinationLatitude: 6.5, destinationLongitude: 3.4, expectedArrivalAt: new Date(Date.now() + 600_000).toISOString(), safeWalkCreateKey: randomUUID() };
    const results = await Promise.all(owners.map(owner => api.startSession(owner.id, plan)));
    expect(new Set(results.map(result => result.sessionId)).size).toBe(2);
    expect(await db.safeWalkAudit.count({ where: { kind: 'STARTED' } })).toBe(2);
  });

  async function overdue() {
    const owner = await createUser(), guardian = await createUser();
    const eta = new Date(Date.now() - 9 * 60_000);
    const due = deadlines(eta);
    const session = await db.journeySession.create({ data: { userId: owner.id, purpose: 'SAFEWALK', expectedArrivalAt: eta, safeWalkEscalation: { create: { ...due, state: 'CHECK_REQUIRED', checkRequiredAt: due.checkDueAt, responseDueAt: due.guardianDueAt } } } });
    const code = await guardians.issueCode(guardian.id);
    await guardians.authorize(owner.id, session.id, code.code);
    await new SafeWalkEscalationService(db as never, snapshots).processSession(session.id);
    const notice = await db.safeWalkNotice.findFirstOrThrow({ where: { sessionId: session.id, kind: 'GUARDIAN_OVERDUE' } });
    return { owner, guardian, session, notice };
  }

  it('uses the shared ledger once under concurrent dispatch and never promotes acceptance to delivery', async () => {
    const { notice, guardian, session } = await overdue();
    const send = jest.fn().mockResolvedValue({ success: true, provider: 'Email', messageId: randomUUID() });
    const worker = new SafeWalkNotificationWorker(db as never, ledger, { send } as never, snapshots);
    await Promise.all(Array.from({ length: 5 }, () => worker.dispatch(notice.id)));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toEqual(expect.objectContaining({ recipient: guardian.email, message: expect.stringContaining('non-emergency') }));
    const result = await db.safeWalkNotice.findUniqueOrThrow({ where: { id: notice.id } });
    expect(result.deliveryStatus).toBe('PROVIDER_ACCEPTED');
    expect(result.confirmedDeliveredAt).toBeNull();
    expect(await db.deliveryAttempt.count({ where: { safeWalkNoticeId: notice.id } })).toBe(1);
    expect(await db.deliveryStatusEvent.count({ where: { safeWalkNoticeId: notice.id, source: 'OUTBOX' } })).toBe(1);
    expect(await db.incident.count()).toBe(0);
    const status = await ownerApi.getStatus(session.userId, session.id);
    expect(status.visibility).toBe('PRIVATE');
    expect(JSON.stringify(status)).not.toContain(guardian.email);
  });

  it('applies verified receipts through the existing delivery ledger', async () => {
    const { notice } = await overdue();
    const messageId = randomUUID();
    const worker = new SafeWalkNotificationWorker(db as never, ledger, { send: async () => ({ success: true, provider: 'Email', messageId }) } as never, snapshots);
    await worker.dispatch(notice.id);
    const reference = await db.providerReference.findFirstOrThrow({ where: { messageId } });
    const receipt = await db.providerDeliveryReceipt.create({ data: { provider: reference.provider, accountScope: reference.accountScope, eventId: randomUUID(), messageId, eventType: 'email.delivered', status: 'DELIVERED', occurredAt: new Date() } });
    await Promise.all([ledger.applyReceipt(receipt.id), ledger.applyReceipt(receipt.id)]);
    expect((await db.safeWalkNotice.findUniqueOrThrow({ where: { id: notice.id } })).deliveryStatus).toBe('DELIVERED');
    expect(await db.deliveryStatusEvent.count({ where: { receiptId: receipt.id } })).toBe(1);
  });

  it('does not dispatch a guardian notice after owner completion wins the lock', async () => {
    const { owner, session, notice } = await overdue();
    await ownerApi.confirm(owner.id, session.id, 'ARRIVAL');
    const send = jest.fn();
    await new SafeWalkNotificationWorker(db as never, ledger, { send } as never, snapshots).dispatch(notice.id);
    expect(send).not.toHaveBeenCalled();
    expect(await db.deliveryAttempt.count()).toBe(0);
  });

  it('protects institutional recipient snapshots and audits their delivery resolution', async () => {
    const recipient = await createUser(), actor = await createUser();
    const facility = await db.facility.create({ data: { name: 'Isolated test tenant', type: 'OTHER' } });
    await db.user.update({ where: { id: recipient.id }, data: { facilityId: facility.id } });
    await db.user.update({ where: { id: actor.id }, data: { facilityId: facility.id, role: 'FACILITY_ADMIN' } });
    await db.identityAccessGrant.createMany({ data: ['WRITE', 'DELIVERY'].map(permission => ({ tenantId: facility.id, actorUserId: actor.id, permission: permission as 'WRITE' | 'DELIVERY', approvedByReference: actor.id, expiresAt: new Date(Date.now() + 600_000) })) });
    const before = process.env.PII_DELIVERY_ACTOR_USER_ID;
    process.env.PII_DELIVERY_ACTOR_USER_ID = actor.id;
    try {
      const crypto = new LocalIdentityCrypto(new Map([['test', Buffer.alloc(32, 1)]]), 'test', Buffer.alloc(32, 2), 'test');
      const protectedSnapshots = new ProtectedSnapshotsService(db as never, new ProtectedIdentityService(db as never, crypto));
      const session = await db.journeySession.create({ data: { userId: recipient.id, purpose: 'SAFEWALK' } });
      const id = randomUUID();
      const data = await db.$transaction(tx => protectedSnapshots.safeWalkRecipientData(tx, id, recipient.id));
      expect(data.recipient).toBe('[protected]');
      const row = await db.safeWalkNotice.create({ data: { id, ...data, sessionId: session.id, recipientUserId: recipient.id, kind: 'OWNER_CHECK', message: 'SafeWalk safety check', reasonCode: 'EXPECTED_ARRIVAL_NOT_CONFIRMED' } });
      expect(JSON.stringify(row)).not.toContain(recipient.email);
      expect(await protectedSnapshots.safeWalkRecipient(data.protectedSnapshotId!, id, recipient.id)).toBe(recipient.email);
      expect(await db.identityResolutionAudit.count({ where: { caseReference: id, purpose: 'DELIVERY' } })).toBe(1);
      await expect(protectedSnapshots.safeWalkRecipient(data.protectedSnapshotId!, randomUUID(), recipient.id)).rejects.toThrow();
    } finally { if (before === undefined) delete process.env.PII_DELIVERY_ACTOR_USER_ID; else process.env.PII_DELIVERY_ACTOR_USER_ID = before; }
  });
});
