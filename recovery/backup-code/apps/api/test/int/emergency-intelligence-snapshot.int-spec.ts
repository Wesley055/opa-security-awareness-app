import { prismaTest } from './prisma-test-client';
import { createSession, createUser } from './fixtures';
import { EmergencyIntelligenceSnapshotService } from '../../src/modules/emergency-intelligence/emergency-intelligence-snapshot.service';

describe('EmergencyIntelligenceSnapshotService integration', () => {
  async function createFix(
    journeySessionId: string,
    sequence: number,
    receivedAt: Date,
  ) {
    return prismaTest.journeyLocationFix.create({
      data: {
        journeySessionId,
        sequence,
        idempotencyKey: `snapshot-int-${sequence}`,
        latitude: '6.524400',
        longitude: '3.379200',
        accuracy: 5,
        speed: 1,
        heading: 90,
        batteryLevel: 80,
        isCharging: false,
        source: 'foreground',
        recordedAt: receivedAt,
        receivedAt,
        nonce: 'a'.repeat(64),
        payloadHash: String(sequence + 1).repeat(64).slice(0, 64),
        previousHash: sequence === 0 ? null : 'b'.repeat(64),
        hash: String(sequence + 2).repeat(64).slice(0, 64),
      },
    });
  }

  it('does not let an older refresh overwrite a newer snapshot', async () => {
    const user = await createUser();
    const session = await createSession(user.id, { status: 'ACTIVE' });

    await createFix(
      session.id,
      0,
      new Date('2026-08-29T20:00:00.000Z'),
    );
    await createFix(
      session.id,
      1,
      new Date('2026-08-29T20:00:01.000Z'),
    );

    const emergencyIntelligenceService = {
      buildLocationIntelligence: jest.fn(async (dto: { latitude: number }) => ({
        generatedAt: new Date().toISOString(),
        location: {
          latitude: dto.latitude,
        },
      })),
    };

    const service = new EmergencyIntelligenceSnapshotService(
      prismaTest as never,
      emergencyIntelligenceService as never,
    );

    await expect(
      service.refreshFromCommittedFix(session.id, 1),
    ).resolves.toBe(true);

    await expect(
      service.refreshFromCommittedFix(session.id, 0),
    ).resolves.toBe(false);

    const snapshot =
      await prismaTest.emergencyIntelligenceSnapshot.findUniqueOrThrow({
        where: { journeySessionId: session.id },
      });

    expect(snapshot.sourceFixSequence).toBe(1);
    expect(snapshot.sourceFixReceivedAt).toEqual(
      new Date('2026-08-29T20:00:01.000Z'),
    );
  });

  it('refuses persistence when the source is redacted during provider work', async () => {
    const user = await createUser();
    const session = await createSession(user.id, { status: 'ACTIVE' });

    const source = await createFix(
      session.id,
      0,
      new Date('2026-08-29T21:00:00.000Z'),
    );

    const emergencyIntelligenceService = {
      buildLocationIntelligence: jest.fn(async () => {
        await prismaTest.journeyLocationFix.update({
          where: { id: source.id },
          data: {
            latitude: null,
            longitude: null,
            nonce: null,
            redactedAt: new Date(),
          },
        });

        return {
          generatedAt: new Date().toISOString(),
          location: { latitude: 6.5244, longitude: 3.3792 },
        };
      }),
    };

    const service = new EmergencyIntelligenceSnapshotService(
      prismaTest as never,
      emergencyIntelligenceService as never,
    );

    await expect(
      service.refreshFromCommittedFix(session.id, 0),
    ).resolves.toBe(false);

    const snapshot =
      await prismaTest.emergencyIntelligenceSnapshot.findUnique({
        where: { journeySessionId: session.id },
      });

    expect(snapshot).toBeNull();
  });
});