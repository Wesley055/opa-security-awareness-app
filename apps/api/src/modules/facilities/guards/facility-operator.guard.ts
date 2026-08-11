import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import type { JwtPayload } from '../../auth/jwt.strategy';

type AuthenticatedRequest = Request & { user: JwtPayload };

/**
 * Restricts one facility's Command Center data to a FACILITY_OPERATOR
 * assigned to that facility, or ADMIN.
 *
 * ADMIN is deliberately a platform-wide cross-tenant override.
 *
 * Role and facilityId are re-read from the database rather than trusted
 * from JWT claims, because authorization must reflect current truth after
 * promotion, demotion or facility reassignment.
 */
@Injectable()
export class FacilityOperatorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requestedFacilityId = request.params.facilityId;

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true, facilityId: true },
    });

    if (!user) {
      throw new ForbiddenException('User not found.');
    }

    if (user.role === 'ADMIN') {
      return true;
    }

    if (user.role !== 'FACILITY_OPERATOR') {
      throw new ForbiddenException('Not authorized for facility access.');
    }

    if (!user.facilityId || user.facilityId !== requestedFacilityId) {
      throw new ForbiddenException(
        'Not authorized for this facility.',
      );
    }

    return true;
  }
}