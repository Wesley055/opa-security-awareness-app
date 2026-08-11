import { BadRequestException } from '@nestjs/common';
import { IncidentTrigger } from '@prisma/client';
import { IncidentsService } from './incidents.service';

describe('IncidentsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
    },
    incident: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  // IncidentsService gained THREE dependencies when resolve/cancel were
  // added: tokens, timeline, and the journey session service. Neither test
  // here reaches them - both only call create - so bare doubles are enough.
  // Lifecycle behaviour is covered by incidents.lifecycle.spec.ts and by
  // test/int/incident-lifecycle-concurrency.int-spec.ts.
  const accessTokens = { revokeAllForIncident: jest.fn() };
  const timeline = { recordEvent: jest.fn() };
  const journeySessions = { endSession: jest.fn() };

  const makeService = () =>
    new IncidentsService(
      prisma as never,
      accessTokens as never,
      timeline as never,
      journeySessions as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.$executeRaw.mockResolvedValue(undefined);
    prisma.user.findUnique.mockResolvedValue({ facilityId: null });
  });

  it('creates SOS incidents with redis dispatch metadata prepared', async () => {
    prisma.incident.create.mockResolvedValue({ id: 'incident-id' });
    const service = makeService();

    await service.create('user-id', {
      trigger: IncidentTrigger.SOS_BUTTON,
      latitude: 6.5244,
      longitude: 3.3792,
    });

    expect(prisma.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-id',
          metadata: expect.objectContaining({ redisDispatchPrepared: true }),
        }),
      }),
    );
  });

  it('snapshots the resident facility onto the incident', async () => {
    prisma.user.findUnique.mockResolvedValue({ facilityId: 'facility-a' });
    prisma.incident.create.mockResolvedValue({
      id: 'incident-id',
      facilityId: 'facility-a',
    });
    const service = makeService();

    await service.create('user-id', {
      trigger: IncidentTrigger.SOS_BUTTON,
      latitude: 6.5244,
      longitude: 3.3792,
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      select: { facilityId: true },
    });
    expect(prisma.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-id',
          facilityId: 'facility-a',
        }),
      }),
    );
  });

  it('writes null facilityId when the resident has no facility', async () => {
    prisma.user.findUnique.mockResolvedValue({ facilityId: null });
    prisma.incident.create.mockResolvedValue({
      id: 'incident-id',
      facilityId: null,
    });
    const service = makeService();

    await service.create('user-id', {
      trigger: IncidentTrigger.SOS_BUTTON,
      latitude: 6.5244,
      longitude: 3.3792,
    });

    expect(prisma.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-id',
          facilityId: null,
        }),
      }),
    );
  });

  // THE IMPORTANT ONE, AND IT IS NOT REDUNDANT.
  // Under this design facilityId is not a parameter, so a client supplying
  // one is structurally impossible - which is exactly why the property is
  // worth pinning. The next path that gains facility support may reintroduce
  // a parameter, and this test is what fails when it does. It is the
  // difference between "we route incidents to facilities" and "a client can
  // post an emergency into any estate's queue".
  it('ignores a facilityId supplied by the caller', async () => {
    prisma.user.findUnique.mockResolvedValue({ facilityId: 'facility-a' });
    prisma.incident.create.mockResolvedValue({ id: 'incident-id' });
    const service = makeService();

    // Deliberately bypass the TypeScript DTO contract to model an untrusted
    // runtime caller. The service must still ignore this excess property and
    // derive facilityId only from authoritative database membership.
    const maliciousDto = {
      trigger: IncidentTrigger.SOS_BUTTON,
      latitude: 6.5244,
      longitude: 3.3792,
      facilityId: 'attacker-chosen-facility',
    } as unknown as Parameters<IncidentsService['create']>[1];

    await service.create('user-id', maliciousDto);

    const args = prisma.incident.create.mock.calls[0][0];
    expect(args.data.facilityId).toBe('facility-a');
  });

  it('wraps the direct create path in one transaction', async () => {
    prisma.user.findUnique.mockResolvedValue({ facilityId: 'facility-a' });
    prisma.incident.create.mockResolvedValue({ id: 'incident-id' });
    const service = makeService();

    await service.create('user-id', {
      trigger: IncidentTrigger.SOS_BUTTON,
      latitude: 6.5244,
      longitude: 3.3792,
    });

    // The membership read and the insert must not be torn apart.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const readOrder = prisma.user.findUnique.mock.invocationCallOrder[0];
    const createOrder = prisma.incident.create.mock.invocationCallOrder[0];

    if (readOrder === undefined || createOrder === undefined) {
      throw new Error('Expected a membership read and an incident create.');
    }

    expect(readOrder).toBeLessThan(createOrder);
  });

  it('requires exact HELP HELP phrase for voice incidents', async () => {
    const service = makeService();

    await expect(
      service.create('user-id', {
        trigger: IncidentTrigger.VOICE_HELP_HELP,
        latitude: 6.5244,
        longitude: 3.3792,
        voicePhrase: 'help me',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});