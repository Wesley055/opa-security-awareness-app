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
 * Restricts access to one facility's data to staff assigned to that
 * facility, or admins. Deliberately re-reads role and facilityId from
 * the database rather than trusting the JWT — the token can be stale
 * (e.g. someone promoted to HOSPITAL_STAFF after their token was
 * issued), and a permission check this important should reflect
 * current truth, not a cached claim.
 */
@Injectable()
export class FacilityStaffGuard implements CanActivate {
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

    if (user.role !== 'HOSPITAL_STAFF') {
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