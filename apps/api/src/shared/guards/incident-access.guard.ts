import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../modules/auth/jwt.strategy';
import { incidentScope } from '../security/incident-scope';

/** Shared read/evidence boundary. Never load an incident outside the caller's scope. */
@Injectable()
export class IncidentAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: JwtPayload }>();
    const actor = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: {
        role: true,
        facilityId: true,
        isActive: true,
        accountStatus: true,
      },
    });
    const incident = await this.prisma.incident.findFirst({
      where: {
        AND: [
          { id: request.params.incidentId as string },
          incidentScope(request.user.sub, actor),
        ],
      },
      select: { id: true },
    });
    if (!incident) throw new NotFoundException('Incident not found.');
    return true;
  }
}
