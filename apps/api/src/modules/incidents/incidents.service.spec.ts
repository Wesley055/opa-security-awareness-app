import { BadRequestException } from '@nestjs/common';
import { IncidentTrigger } from '@prisma/client';
import { IncidentsService } from './incidents.service';

describe('IncidentsService', () => {
  const prisma = {
    incident: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  // IncidentsService gained two dependencies when resolve/cancel were added.
  // Neither test here reaches them - both only call create - so bare doubles
  // are enough. Lifecycle behaviour is covered by incidents.lifecycle.spec.ts
  // and by test/int/incident-lifecycle-concurrency.int-spec.ts.
  const accessTokens = { revokeAllForIncident: jest.fn() };
  const timeline = { recordEvent: jest.fn() };

  const makeService = () =>
    new IncidentsService(
      prisma as never,
      accessTokens as never,
      timeline as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
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