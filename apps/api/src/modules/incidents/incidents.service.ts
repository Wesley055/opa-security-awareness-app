import { BadRequestException, Injectable } from '@nestjs/common';
import { IncidentTrigger, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateIncidentDto } from './dto/create-incident.dto';

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateIncidentDto, tx?: Prisma.TransactionClient) {
    if (
      dto.trigger === IncidentTrigger.VOICE_HELP_HELP &&
      dto.voicePhrase?.toUpperCase() !== 'HELP HELP'
    ) {
      throw new BadRequestException(
        'Voice-triggered incidents require phrase HELP HELP.',
      );
    }

    const db = tx ?? this.prisma;
    return db.incident.create({
      data: {
        userId,
        trigger: dto.trigger,
        latitude: dto.latitude,
        longitude: dto.longitude,
        address: dto.address,
        voicePhrase: dto.voicePhrase,
        // Initialised so the SOS dedupe window can find this incident.
        lastTriggeredAt: new Date(),
        metadata: {
          redisDispatchPrepared: true,
          notificationFanoutPrepared: true,
        },
      },
    });
  }

  listForUser(userId: string) {
    return this.prisma.incident.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}