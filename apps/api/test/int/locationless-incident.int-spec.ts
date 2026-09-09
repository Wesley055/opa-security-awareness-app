import { prismaTest } from './prisma-test-client';
import { createUser } from './fixtures';
import { IncidentOrchestratorService } from '../../src/modules/incident-orchestrator/incident-orchestrator.service';
import { IncidentsService } from '../../src/modules/incidents/incidents.service';
import { IncidentAccessTokenService } from '../../src/modules/incident-access/incident-access-token.service';
import { IncidentTimelineService } from '../../src/modules/incident-timeline/incident-timeline.service';
import { JourneySessionService } from '../../src/modules/journey/journey-session.service';
import { NotificationService } from '../../src/modules/notifications/notification.service';
import { NotificationDispatchWorker } from '../../src/modules/notifications/notification-dispatch.worker';
import { IncidentTrackingService } from '../../src/modules/incidents/incident-tracking.service';
import { PublicTrackingService } from '../../src/modules/incident-access/public-tracking.service';
import type { CreateIncidentRequestDto } from '../../src/modules/incident-orchestrator/dto/create-incident-request.dto';
import { readFileSync } from 'fs';
import { join } from 'path';

const dto: CreateIncidentRequestDto = { triggerType: 'VOICE' as never, mode: 'SILENT' as never, detectedPhrase: 'HELP HELP' };
function services() {
  const db = prismaTest as never;
  const tokens = new IncidentAccessTokenService(db);
  const timeline = new IncidentTimelineService(db);
  const journey = new JourneySessionService();
  const incidents = new IncidentsService(db, tokens, timeline, journey);
  const provider = { send: jest.fn().mockResolvedValue({ success: true, provider: 'test', messageId: 'test-message' }) };
  const notifications = new NotificationService(db, provider as never, provider as never, provider as never, provider as never, provider as never);
  const intelligence = { buildLocationIntelligence: jest.fn().mockResolvedValue({}) };
  const orchestrator = new IncidentOrchestratorService(
    { evaluate: () => ({ outcome: { shouldActivate: true, isSilent: true } }) } as never,
    intelligence as never, incidents,
    { listForUser: (userId: string) => prismaTest.emergencyContact.findMany({ where: { userId } }) } as never,
    notifications,
    { findById: (id: string) => prismaTest.user.findUnique({ where: { id } }) } as never,
    timeline, db, tokens, journey,
  );
  return { orchestrator, intelligence, provider, notifications, tokens };
}

describe('locationless incident production persistence', () => {
  it('creates a real emergency, dispatches notifications, and later records a real location', async () => {
    const user = await createUser();
    await prismaTest.emergencyContact.create({ data: { userId: user.id, firstName: 'Test', lastName: 'Contact', relationship: 'FAMILY', phoneNumber: '+2348000000000', receivesEmergencySms: true } });
    const s = services();
    const result = await s.orchestrator.createCoordinatedIncident(user.id, dto);
    expect(result.status).toBe('INCIDENT_ACTIVATED');
    const incident = await prismaTest.incident.findUniqueOrThrow({ where: { id: result.incident!.id } });
    expect(incident.latitude).toBeNull(); expect(incident.longitude).toBeNull();
    expect(s.intelligence.buildLocationIntelligence).not.toHaveBeenCalled();
    expect(await prismaTest.journeyLocationFix.count()).toBe(0);
    expect(await prismaTest.incidentTimelineEvent.count({ where: { type: 'LOCATION_ATTACHED' } })).toBe(0);
    const tracking = await new IncidentTrackingService(prismaTest as never).getTracking(incident.id);
    expect(tracking.latest).toBeNull();
    const { token } = await s.tokens.issue(incident.id);
    expect(await new PublicTrackingService(prismaTest as never, s.tokens).getSnapshot(token)).toMatchObject({ state: 'VALID', incident: { location: null } });
    await new NotificationDispatchWorker(prismaTest as never, s.notifications).tick();
    expect(s.provider.send).toHaveBeenCalledTimes(2);
    for (const [payload] of s.provider.send.mock.calls) {
      expect(payload.message).toContain('Location unavailable');
      expect(payload.message).toContain('may be in danger');
      expect(payload.message).not.toContain('maps.google');
    }
    expect(await prismaTest.incidentNotification.count({ where: { status: 'SENT' } })).toBe(2);
    const retrigger = await s.orchestrator.createCoordinatedIncident(user.id, { ...dto, latitude: 6.5, longitude: 3.3 });
    expect(retrigger.status).toBe('INCIDENT_RETRIGGERED');
    expect(retrigger.incident!.id).toBe(incident.id);
    expect(await prismaTest.journeyLocationFix.count()).toBe(1);
    const later = await new IncidentTrackingService(prismaTest as never).getTracking(incident.id);
    expect(later.latest).toMatchObject({ latitude: 6.5, longitude: 3.3 });
    expect(later.movement?.distanceFromActivationMeters).toBeNull();
  });

  it('serializes concurrent locationless activations into one OPEN incident', async () => {
    const user = await createUser(); const s = services();
    const results = await Promise.all([s.orchestrator.createCoordinatedIncident(user.id, dto), s.orchestrator.createCoordinatedIncident(user.id, dto)]);
    expect(new Set(results.map(r => r.incident!.id)).size).toBe(1);
    expect(results.map(r => r.status).sort()).toEqual(['INCIDENT_ACTIVATED', 'INCIDENT_RETRIGGERED']);
    expect(await prismaTest.incident.count({ where: { userId: user.id, status: 'OPEN' } })).toBe(1);
    expect(await prismaTest.journeyLocationFix.count()).toBe(0);
    await expect(prismaTest.incident.create({ data: { userId: user.id, trigger: 'SOS_BUTTON' } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each([{ latitude: 6.5 }, { longitude: 3.3 }])('database rejects partial coordinates %p', async coords => {
    const user = await createUser();
    await expect(prismaTest.incident.create({ data: { userId: user.id, trigger: 'SOS_BUTTON', ...coords } })).rejects.toThrow();
  });

  it('migration preserves populated coordinate values and other constraints', async () => {
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20260909010000_allow_locationless_incidents/migration.sql'), 'utf8');
    await prismaTest.$transaction(async tx => {
      // Temporary table shadows only this connection; production tables are untouched.
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "Incident" (id integer PRIMARY KEY, latitude decimal(9,6) NOT NULL, longitude decimal(9,6) NOT NULL) ON COMMIT DROP');
      await tx.$executeRawUnsafe('INSERT INTO "Incident" VALUES (1, 6.500000, 3.300000)');
      for (const statement of sql.split(';').filter(s => s.trim())) await tx.$executeRawUnsafe(statement);
      const rows = await tx.$queryRawUnsafe<{ latitude: unknown; longitude: unknown }[]>('SELECT latitude, longitude FROM "Incident" WHERE id=1');
      expect(String(rows[0]!.latitude)).toBe('6.5'); expect(String(rows[0]!.longitude)).toBe('3.3');
      await tx.$executeRawUnsafe('INSERT INTO "Incident" (id) VALUES (2)');
    });
  });
});
