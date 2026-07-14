import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FacilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  listIncidentsForFacility(facilityId: string) {
    return this.prisma.incident.findMany({
      where: { facilityId },
      include: {
        user: {
          select: { firstName: true, lastName: true },
        },
        notifications: {
          orderBy: { queuedAt: 'asc' },
        },
        evidence: true,
        timelineEvents: {
          orderBy: { sequence: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}