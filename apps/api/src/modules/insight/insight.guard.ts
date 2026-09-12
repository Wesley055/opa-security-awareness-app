import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { OperatorFacilityGuard } from '../facilities/guards/operator-facility.guard';
import { FacilityAdminGuard } from '../facilities/guards/facility-admin.guard';

/** Reuse role guards; the service rechecks authority in its transaction. */
@Injectable()
export class InsightGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly admin: AdminGuard,
    private readonly operator: OperatorFacilityGuard, private readonly facilityAdmin: FacilityAdminGuard) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    const actor = await this.prisma.user.findUnique({ where: { id: request.user.sub }, select: { role: true } });
    if (actor?.role === 'ADMIN') return this.admin.canActivate(context);
    if (actor?.role === 'FACILITY_ADMIN') return this.facilityAdmin.canActivate(context);
    if (actor?.role === 'FACILITY_OPERATOR') return this.operator.canActivate(context);
    throw new ForbiddenException('Institutional reporting access denied.');
  }
}
