import { ApiExcludeController } from "@nestjs/swagger";
import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { JwtPayload } from "../auth/jwt.strategy";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { InsightService } from "./insight.service";
import { OrganizationQueryDto } from "./insight.dto";

type AuthRequest = Request & { user: JwtPayload };

/** Early rejection only; the service rechecks authority in its transaction. */
@Injectable()
export class OrganizationAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const actor = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true },
    });
    if (actor?.role !== "ORGANIZATION_ADMIN")
      throw new ForbiddenException("Head Office reporting access denied.");
    return true;
  }
}

@Controller("organization/insight")
@ApiExcludeController()
@UseGuards(JwtAuthGuard, OrganizationAdminGuard)
export class OrganizationInsightController {
  constructor(private readonly service: InsightService) {}
  @Get("overview")
  @Header("Cache-Control", "no-store")
  overview(@Req() req: AuthRequest, @Query() query: OrganizationQueryDto) {
    return this.service.organizationOverview(req.user.sub, query);
  }
}
