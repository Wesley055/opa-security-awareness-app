import { ConflictException, NotFoundException } from '@nestjs/common';
import { prismaTest } from './prisma-test-client';
import { createUser, createSession, createIncident } from './fixtures';
import { SafeWalkService } from '../../src/modules/journey/safewalk.service';
import { JourneySessionService } from '../../src/modules/journey/journey-session.service';
import { IncidentTrackingService } from '../../src/modules/incidents/incident-tracking.service';

const journeys = new JourneySessionService();
const service = new SafeWalkService(prismaTest as never, journeys);

describe('SafeWalk PostgreSQL confirmations and privacy', () => {
  it('serializes concurrent arrivals and preserves the original confirmation', async () => {
    const owner = await createUser();
    const session = await createSession(owner.id, { purpose: 'SAFEWALK' });
    const results = await Promise.all([
      service.confirm(owner.id, session.id, 'ARRIVAL'),
      service.confirm(owner.id, session.id, 'ARRIVAL'),
    ]);
    expect(results.filter((result) => result.alreadyConfirmed)).toHaveLength(1);
    expect(results[0].confirmedAt).toEqual(results[1].confirmedAt);
    const row = await prismaTest.journeySession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe('ENDED');
    expect(row.arrivalConfirmedAt).toEqual(results[0].confirmedAt);
    expect(row.endedAt).not.toBeNull();
    expect(await prismaTest.incident.count()).toBe(0);
  });
  it('preserves live emergency tracking and incident truth', async () => {
    const owner = await createUser();
    const session = await createSession(owner.id, { purpose: 'SAFEWALK' });
    const incident = await createIncident(owner.id, { journeySessionId: session.id });
    await expect(service.confirm(owner.id, session.id, 'ARRIVAL')).rejects.toBeInstanceOf(ConflictException);
    await service.confirm(owner.id, session.id, 'SAFETY');
    const row = await prismaTest.journeySession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe('STARTED');
    expect(row.arrivalConfirmedAt).toBeNull();
    expect(row.safetyConfirmedAt).not.toBeNull();
    expect((await prismaTest.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe('OPEN');
  });
  it('hides another owners journey from reads and confirmations', async () => {
    const owner = await createUser();
    const other = await createUser();
    const session = await createSession(owner.id, { purpose: 'SAFEWALK' });
    await expect(service.getStatus(other.id, session.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.confirm(other.id, session.id, 'SAFETY')).rejects.toBeInstanceOf(NotFoundException);
    expect((await prismaTest.journeySession.findUniqueOrThrow({ where: { id: session.id } })).safetyConfirmedAt).toBeNull();
  });
  it('excludes late-uploaded personal history from operator routes', async () => {
    const owner = await createUser();
    const session = await createSession(owner.id, { purpose: 'SAFEWALK' });
    const incident = await createIncident(owner.id, { journeySessionId: session.id });
    await prismaTest.$transaction((tx) => journeys.recordTrackedFixes(tx, {
      sessionId: session.id,
      fixes: [{
        idempotencyKey: 'buffered-personal', source: 'background', latitude: 8, longitude: 9,
        recordedAt: new Date(incident.createdAt.getTime() - 60_000),
      }],
    }));
    const result = await new IncidentTrackingService(prismaTest as never).getTracking(incident.id);
    expect(result.points).toEqual([]);
    expect(result.latest!.origin).toBe('ACTIVATION');
    expect(result.emergencyIntelligence).toBeNull();
    expect(result.lastFixReceivedAt).toBeNull();
    await prismaTest.$transaction((tx) => journeys.recordTrackedFixes(tx, {
      sessionId: session.id,
      fixes: [{
        idempotencyKey: 'emergency-tracking', source: 'background', latitude: 10, longitude: 11,
        recordedAt: new Date(incident.createdAt.getTime() + 1),
      }],
    }));
    const emergency = await new IncidentTrackingService(prismaTest as never).getTracking(incident.id);
    expect(emergency.points).toHaveLength(1);
    expect(emergency.latest!.latitude).toBe(10);
    expect(emergency.lastFixReceivedAt).not.toBeNull();
  });
});
