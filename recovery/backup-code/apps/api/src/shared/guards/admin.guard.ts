import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../modules/auth/jwt.strategy';

type AuthenticatedRequest = Request & { user: JwtPayload };

/**
 * Platform-administration boundary.
 *
 * Deliberately re-reads the current role from PostgreSQL rather than trusting
 * request.user.role. A JWT can outlive a demotion; administrative authority
 * must not.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true, isActive: true },
    });

    if (!user || !user.isActive || user.role !== 'ADMIN') {
      throw new ForbiddenException('Administrator access required.');
    }

    return true;
  }
}
