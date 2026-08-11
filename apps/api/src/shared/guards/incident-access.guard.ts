import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../modules/auth/jwt.strategy';

type AuthenticatedRequest = Request & { user: JwtPayload };

/**
 * An incident is visible to its owner, a FACILITY_OPERATOR currently
 * assigned to the facility snapshotted on the incident, or ADMIN.
 *
 * ADMIN is deliberately a platform-wide cross-tenant override.
 *
 * Facility authorization is re-read from the database rather than trusted
 * from JWT claims so revocation and reassignment take effect immediately.
 *
 * Shared by IncidentTimelineModule and EvidenceModule. Both need identical
 * access rules, so this lives in one place rather than as two copies that
 * could quietly drift apart.
 */
@Injectable()
export class IncidentAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const incidentId = request.params.incidentId as string;

    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: { userId: true, facilityId: true },
    });

    if (!incident) {
      throw new NotFoundException('Incident not found.');
    }

    if (incident.userId === request.user.sub) {
      return true;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true, facilityId: true },
    });

    if (user?.role === 'ADMIN') {
      return true;
    }

    if (
      user?.role === 'FACILITY_OPERATOR' &&
      user.facilityId &&
      user.facilityId === incident.facilityId
    ) {
      return true;
    }

    throw new ForbiddenException('Not authorized for this incident.');
  }
}