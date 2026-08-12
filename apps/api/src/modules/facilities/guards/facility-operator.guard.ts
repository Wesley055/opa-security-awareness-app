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
 * Role, facilityId and isActive are re-read from the database rather than
 * trusted from JWT claims, because authorization must reflect current
 * truth after promotion, demotion, suspension or facility reassignment.
 *
 * isActive HERE IS THE USER'S, NOT THE FACILITY'S. A deactivated FACILITY
 * deliberately keeps its queue visible - see FacilitiesService - because
 * deactivation is not a revocation workflow and incidents still route
 * there. A suspended USER is a different question with a different
 * answer.
 */
@Injectable()
export class FacilityOperatorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requestedFacilityId = request.params.facilityId;

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true, facilityId: true, isActive: true },
    });

    if (!user) {
      throw new ForbiddenException('User not found.');
    }

    // SUSPENSION OUTRANKS ROLE, so this sits above the ADMIN branch. A
    // suspended administrator must not keep cross-tenant access to every
    // facility's emergency queue merely because the role check comes
    // first - AdminGuard already refuses them, and these two must agree.
    if (!user.isActive) {
      // Named rather than folded into the generic refusal. This endpoint is
      // AUTHENTICATED, so the caller already knows the account exists;
      // telling them it is suspended costs no disclosure and saves a
      // support desk from guessing. The unauthenticated paths - activation
      // and refresh - deliberately do the opposite.
      throw new ForbiddenException('User account is inactive.');
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