import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import type { JwtPayload } from '../../auth/jwt.strategy';

export type FacilityAdminRequest = Request & {
  user: JwtPayload;
  /**
   * Set only by this guard from the current Postgres user row.
   * Never accepted from a URL, query string, or request body.
   */
  facilityAdminFacilityId: string;
};

@Injectable()
export class FacilityAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FacilityAdminRequest>();

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: {
        role: true,
        facilityId: true,
        isActive: true,
        accountStatus: true,
      },
    });

    if (!user) {
      throw new ForbiddenException('User not found.');
    }

    if (!user.isActive || user.accountStatus !== 'ACTIVE') {
      throw new ForbiddenException('User account is inactive.');
    }

    if (user.role !== 'FACILITY_ADMIN') {
      throw new ForbiddenException('Facility administrator access required.');
    }

    if (!user.facilityId) {
      throw new ForbiddenException('No facility is assigned to this account.');
    }

    request.facilityAdminFacilityId = user.facilityId;
    return true;
  }
}
