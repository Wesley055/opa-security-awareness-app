import { NotFoundException } from '@nestjs/common';
import {
  IncidentTrackingService,
  OPERATOR_ROUTE_POINT_LIMIT,
} from './incident-tracking.service';

describe('IncidentTrackingService.getTracking', () => {
  function makePrisma() {
    return {
      incident: {
        findUnique: jest.fn(),
      },
      journeySession: {
        findUnique: jest.fn(),
      },
      journeyLocationFix: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      emergencyIntelligenceSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
  }

  const createdAt = new Date('2026-08-22T07:30:00.000Z');

  it('returns activation location and NO_SESSION when no journey is linked', async () => {
    const prisma = makePrisma();

    prisma.incident.findUnique.mockResolvedValue({
      latitude: '33.148270',
      longitude: '-96.810320',
      createdAt,
      journeySessionId: null,
    });

    const result = await new IncidentTrackingService(
      prisma as never,
    ).getTracking('incident-1');

    expect(result.state).toBe('NO_SESSION');
    expect(result.latest).toEqual({
      latitude: 33.14827,
      longitude: -96.81032,
      recordedAt: createdAt.toISOString(),
      receivedAt: null,
      source: 'activation',
      origin: 'ACTIVATION',
    });
    expect(result.points).toEqual([]);

    expect(prisma.journeySession.findUnique).not.toHaveBeenCalled();
    expect(prisma.journeyLocationFix.findFirst).not.toHaveBeenCalled();
    expect(prisma.journeyLocationFix.findMany).not.toHaveBeenCalled();
  });

  it('throws when the incident does not exist', async () => {
    const prisma = makePrisma();
    prisma.incident.findUnique.mockResolvedValue(null);

    await expect(
      new IncidentTrackingService(prisma as never).getTracking('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses the established newest-fix ordering and bounds route history', async () => {
    const prisma = makePrisma();

    prisma.incident.findUnique.mockResolvedValue({
      latitude: '33.148270',
      longitude: '-96.810320',
      createdAt,
      journeySessionId: 'session-1',
    });

    prisma.journeySession.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      lastFixReceivedAt: new Date(),
    });

    prisma.journeyLocationFix.findFirst.mockResolvedValue({
      sequence: 3529,
      latitude: '33.148261',
      longitude: '-96.810317',
      accuracy: 5,
      speed: 1.2,
      heading: 90,
      source: 'background',
      recordedAt: new Date('2026-08-22T08:59:09.999Z'),
      receivedAt: new Date('2026-08-22T08:59:13.018Z'),
    });

    prisma.journeyLocationFix.findMany.mockResolvedValue([]);

    await new IncidentTrackingService(
      prisma as never,
    ).getTracking('incident-1');

    expect(prisma.journeyLocationFix.findFirst).toHaveBeenCalledWith({
      where: {
        journeySessionId: 'session-1',
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: [{ receivedAt: 'desc' }, { sequence: 'desc' }],
      select: {
        sequence: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        speed: true,
        heading: true,
        source: true,
        recordedAt: true,
        receivedAt: true,
      },
    });

    expect(prisma.journeyLocationFix.findMany).toHaveBeenCalledWith({
      where: {
        journeySessionId: 'session-1',
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: [{ recordedAt: 'desc' }, { sequence: 'desc' }],
      take: OPERATOR_ROUTE_POINT_LIMIT,
      select: {
        sequence: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        speed: true,
        heading: true,
        source: true,
        recordedAt: true,
        receivedAt: true,
      },
    });
  });

  it('returns the route in movement order, oldest to newest', async () => {
    const prisma = makePrisma();

    prisma.incident.findUnique.mockResolvedValue({
      latitude: '33.148270',
      longitude: '-96.810320',
      createdAt,
      journeySessionId: 'session-1',
    });

    prisma.journeySession.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      lastFixReceivedAt: new Date(),
    });

    prisma.journeyLocationFix.findFirst.mockResolvedValue({
      sequence: 12,
      latitude: '33.300000',
      longitude: '-96.900000',
      accuracy: null,
      speed: null,
      heading: null,
      source: 'background',
      recordedAt: new Date('2026-08-22T08:02:00.000Z'),
      receivedAt: new Date('2026-08-22T08:02:01.000Z'),
    });

    // Prisma query is newest first.
    prisma.journeyLocationFix.findMany.mockResolvedValue([
      {
        sequence: 12,
        latitude: '33.300000',
        longitude: '-96.900000',
        accuracy: null,
        speed: null,
        heading: null,
        source: 'background',
        recordedAt: new Date('2026-08-22T08:02:00.000Z'),
        receivedAt: new Date('2026-08-22T08:02:01.000Z'),
      },
      {
        sequence: 11,
        latitude: '33.200000',
        longitude: '-96.800000',
        accuracy: null,
        speed: null,
        heading: null,
        source: 'background',
        recordedAt: new Date('2026-08-22T08:01:00.000Z'),
        receivedAt: new Date('2026-08-22T08:01:01.000Z'),
      },
    ]);

    const result = await new IncidentTrackingService(
      prisma as never,
    ).getTracking('incident-1');

    expect(result.points.map((point) => point.sequence)).toEqual([
      11,
      12,
    ]);
  });

  it('exposes the current non-redacted emergency intelligence snapshot', async () => {
    const prisma = makePrisma();

    prisma.incident.findUnique.mockResolvedValue({
      latitude: '33.148270',
      longitude: '-96.810320',
      createdAt,
      journeySessionId: 'session-1',
    });

    prisma.journeySession.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      lastFixReceivedAt: new Date('2026-08-29T20:00:01.000Z'),
    });

    prisma.journeyLocationFix.findFirst.mockResolvedValue(null);
    prisma.journeyLocationFix.findMany.mockResolvedValue([]);

    prisma.emergencyIntelligenceSnapshot.findUnique.mockResolvedValue({
      sourceFixSequence: 7,
      sourceFixReceivedAt: new Date('2026-08-29T20:00:01.000Z'),
      generatedAt: new Date('2026-08-29T20:00:02.000Z'),
      refreshedAt: new Date('2026-08-29T20:00:03.000Z'),
      redactedAt: null,
      payload: {
        location: {
          latitude: 33.14827,
          longitude: -96.81032,
        },
      },
    });

    const result = await new IncidentTrackingService(
      prisma as never,
    ).getTracking('incident-1');

    expect(result.emergencyIntelligence).toEqual({
      sourceFixSequence: 7,
      sourceFixReceivedAt: '2026-08-29T20:00:01.000Z',
      generatedAt: '2026-08-29T20:00:02.000Z',
      refreshedAt: '2026-08-29T20:00:03.000Z',
      payload: {
        location: {
          latitude: 33.14827,
          longitude: -96.81032,
        },
      },
    });

    expect(
      prisma.emergencyIntelligenceSnapshot.findUnique,
    ).toHaveBeenCalledWith({
      where: { journeySessionId: 'session-1' },
      select: {
        sourceFixSequence: true,
        sourceFixReceivedAt: true,
        generatedAt: true,
        refreshedAt: true,
        redactedAt: true,
        payload: true,
      },
    });
  });

  it('suppresses a redacted emergency intelligence snapshot', async () => {
    const prisma = makePrisma();

    prisma.incident.findUnique.mockResolvedValue({
      latitude: '33.148270',
      longitude: '-96.810320',
      createdAt,
      journeySessionId: 'session-1',
    });

    prisma.journeySession.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      lastFixReceivedAt: new Date('2026-08-29T20:00:01.000Z'),
    });

    prisma.journeyLocationFix.findFirst.mockResolvedValue(null);
    prisma.journeyLocationFix.findMany.mockResolvedValue([]);

    prisma.emergencyIntelligenceSnapshot.findUnique.mockResolvedValue({
      sourceFixSequence: 7,
      sourceFixReceivedAt: new Date('2026-08-29T20:00:01.000Z'),
      generatedAt: new Date('2026-08-29T20:00:02.000Z'),
      refreshedAt: new Date('2026-08-29T20:00:03.000Z'),
      redactedAt: new Date('2026-08-29T20:05:00.000Z'),
      payload: {
        location: {
          latitude: 33.14827,
          longitude: -96.81032,
        },
      },
    });

    const result = await new IncidentTrackingService(
      prisma as never,
    ).getTracking('incident-1');

    expect(result.emergencyIntelligence).toBeNull();
  });
  it('falls back to immutable activation coordinates when no usable fix exists', async () => {
    const prisma = makePrisma();

    prisma.incident.findUnique.mockResolvedValue({
      latitude: '33.148270',
      longitude: '-96.810320',
      createdAt,
      journeySessionId: 'session-1',
    });

    prisma.journeySession.findUnique.mockResolvedValue({
      status: 'STARTED',
      lastFixReceivedAt: null,
    });

    prisma.journeyLocationFix.findFirst.mockResolvedValue(null);
    prisma.journeyLocationFix.findMany.mockResolvedValue([]);

    const result = await new IncidentTrackingService(
      prisma as never,
    ).getTracking('incident-1');

    expect(result.state).toBe('AWAITING_FIRST_FIX');
    expect(result.latest.origin).toBe('ACTIVATION');
    expect(result.latest.latitude).toBe(33.14827);
    expect(result.latest.longitude).toBe(-96.81032);
  });
});