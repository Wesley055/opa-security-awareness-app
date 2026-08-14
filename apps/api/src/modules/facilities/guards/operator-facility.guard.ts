import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import type { JwtPayload } from '../../auth/jwt.strategy';

/**
 * Resolves the caller's OWN facility and authorizes the operator queue.
 *
 * FacilityOperatorGuard answers a different question - "may this caller read
 * :facilityId" - and reads params.facilityId to do it. This route has no
 * such param by design, so the two are not interchangeable and neither
 * subsumes the other. Keeping them apart is what lets each doc comment stay
 * true.
 *
 * IT BOTH AUTHORIZES AND ESTABLISHES CONTEXT, which is more than a guard
 * usually does. The alternative is reading the same user row twice on every
 * poll - once here to decide, once in the controller to learn which facility
 * - and this route is polled every five seconds per operator. The resolved
 * id is attached as `operatorFacilityId`, NOT `facilityId`, so nobody
 * reading the controller mistakes it for route input.
 *
 * EVERYTHING IS RE-READ FROM POSTGRES. The JWT carries a role claim and it
 * is ignored here, as in all three sibling guards: authorization must
 * reflect current truth after promotion, demotion, suspension or facility
 * reassignment, and a token minted before any of those still verifies.
 *
 * AN ADMIN WITH NO FACILITY IS REFUSED, and that is deliberate rather than
 * an oversight. FacilityOperatorGuard grants admins a cross-tenant override
 * because a facility is named in the URL for them to override TO. Here there
 * is nothing to override to: the route means "my assigned facility's queue"
 * and an unassigned account has no such queue. An admin who needs to see a
 * particular facility uses the explicit /facilities/:facilityId route, which
 * still admits them.
 *
 * SUSPENSION IS CHECKED BEFORE ROLE, matching FacilityOperatorGuard. A
 * suspended administrator must not keep access merely because the role
 * branch would have returned first.
 */

export type OperatorQueueRequest = Request & {
  user: JwtPayload;
  /**
   * Set by this guard from the database, never from the URL or the body.
   * Present only after canActivate has returned true.
   */
  operatorFacilityId: string;
};

@Injectable()
export class OperatorFacilityGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<OperatorQueueRequest>();

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true, facilityId: true, isActive: true },
    });

    if (!user) {
      throw new ForbiddenException('User not found.');
    }

    if (!user.isActive) {
      // Named rather than folded into the generic refusal. This endpoint is
      // AUTHENTICATED, so the caller already knows the account exists;
      // saying it is suspended costs no disclosure and saves a support desk
      // from guessing.
      throw new ForbiddenException('User account is inactive.');
    }

    if (user.role !== 'FACILITY_OPERATOR' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Not authorized for facility access.');
    }

    if (!user.facilityId) {
      // Distinct message: the caller may be perfectly legitimate and simply
      // unassigned. The console turns this into an explanation rather than
      // a dead end.
      throw new ForbiddenException('No facility is assigned to this account.');
    }

    request.operatorFacilityId = user.facilityId;

    return true;
  }
}