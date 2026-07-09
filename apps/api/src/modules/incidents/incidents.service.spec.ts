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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates SOS incidents with redis dispatch metadata prepared', async () => {
    prisma.incident.create.mockResolvedValue({ id: 'incident-id' });
    const service = new IncidentsService(prisma as never);

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
    const service = new IncidentsService(prisma as never);

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