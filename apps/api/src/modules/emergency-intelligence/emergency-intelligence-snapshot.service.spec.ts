import { EmergencyIntelligenceSnapshotService } from './emergency-intelligence-snapshot.service';

describe('EmergencyIntelligenceSnapshotService', () => {
  const sourceFix = {
    sequence: 7,
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 5,
    speed: 1.5,
    heading: 90,
    batteryLevel: 81,
    isCharging: true,
    recordedAt: new Date('2026-08-29T20:00:00.000Z'),
    receivedAt: new Date('2026-08-29T20:00:01.000Z'),
    redactedAt: null,
  };

  const prisma = {
    journeyLocationFix: {
      findUnique: jest.fn(),
    },
    $executeRaw: jest.fn(),
  };

  const emergencyIntelligenceService = {
    buildLocationIntelligence: jest.fn(),
  };

  let service: EmergencyIntelligenceSnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.journeyLocationFix.findUnique.mockResolvedValue(sourceFix);
    prisma.$executeRaw.mockResolvedValue(1);

    emergencyIntelligenceService.buildLocationIntelligence.mockResolvedValue({
      generatedAt: '2026-08-29T20:00:02.000Z',
      location: {
        latitude: 6.5244,
        longitude: 3.3792,
      },
      movement: {
        speed: 1.5,
        heading: 90,
        altitude: null,
      },
      surroundings: null,
      emergencyResources: null,
      routes: null,
      device: null,
    });

    service = new EmergencyIntelligenceSnapshotService(
      prisma as never,
      emergencyIntelligenceService as never,
    );
  });

  it('builds intelligence from the committed canonical fix', async () => {
    await expect(
      service.refreshFromCommittedFix('session-1', 7),
    ).resolves.toBe(true);

    expect(prisma.journeyLocationFix.findUnique).toHaveBeenCalledWith({
      where: {
        journeySessionId_sequence: {
          journeySessionId: 'session-1',
          sequence: 7,
        },
      },
      select: expect.any(Object),
    });

    expect(
      emergencyIntelligenceService.buildLocationIntelligence,
    ).toHaveBeenCalledWith({
      latitude: 6.5244,
      longitude: 3.3792,
      accuracy: 5,
      speed: 1.5,
      heading: 90,
      batteryLevel: 81,
      isCharging: true,
      timestamp: '2026-08-29T20:00:00.000Z',
    });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('does not build or persist intelligence from a redacted source fix', async () => {
    prisma.journeyLocationFix.findUnique.mockResolvedValue({
      ...sourceFix,
      redactedAt: new Date(),
      latitude: null,
      longitude: null,
    });

    await expect(
      service.refreshFromCommittedFix('session-1', 7),
    ).resolves.toBe(false);

    expect(
      emergencyIntelligenceService.buildLocationIntelligence,
    ).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not build intelligence when the canonical source fix is missing', async () => {
    prisma.journeyLocationFix.findUnique.mockResolvedValue(null);

    await expect(
      service.refreshFromCommittedFix('session-1', 7),
    ).resolves.toBe(false);

    expect(
      emergencyIntelligenceService.buildLocationIntelligence,
    ).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('rechecks redaction and coordinates atomically when persisting', async () => {
    await service.refreshFromCommittedFix('session-1', 7);

    const rawCall = prisma.$executeRaw.mock.calls[0];
    const sql = (rawCall[0] as readonly string[]).join('');

    expect(sql).toContain('source."redactedAt" IS NULL');
    expect(sql).toContain('source."latitude" IS NOT NULL');
    expect(sql).toContain('source."longitude" IS NOT NULL');
  });

  it('prevents an older refresh from overwriting a newer snapshot', async () => {
    await service.refreshFromCommittedFix('session-1', 7);

    const rawCall = prisma.$executeRaw.mock.calls[0];
    const sql = (rawCall[0] as readonly string[]).join('');

    expect(sql).toContain(
      'EXCLUDED."sourceFixSequence" >',
    );
    expect(sql).toContain(
      '"EmergencyIntelligenceSnapshot"."sourceFixSequence"',
    );
  });

  it('reports false when the database rejects a stale snapshot write', async () => {
    prisma.$executeRaw.mockResolvedValue(0);

    await expect(
      service.refreshFromCommittedFix('session-1', 7),
    ).resolves.toBe(false);
  });
});