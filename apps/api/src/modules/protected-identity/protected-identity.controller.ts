import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsUUID } from "class-validator";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { JwtPayload } from "../auth/jwt.strategy";
import { PrismaService } from "../../prisma/prisma.service";
import { ProtectedIdentityService } from "./protected-identity.service";

export class ResolveIdentityDto {
  @IsIn(["SUPPORT_CASE", "ACCOUNT_RECOVERY"])
  purpose: "SUPPORT_CASE" | "ACCOUNT_RECOVERY";
  @IsUUID()
  caseReference: string;
}

@Controller("protected-identities")
@UseGuards(JwtAuthGuard)
export class ProtectedIdentityController {
  constructor(private readonly identities: ProtectedIdentityService, private readonly prisma: PrismaService) {}

  @Get(":id")
  @Header("Cache-Control", "no-store")
  async read(
    @Req() request: Request & { user: JwtPayload },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const tenantId = await this.prisma.$transaction(tx => this.identities.actorScope(tx, request.user.sub));
    return this.identities.readMasked(request.user.sub, tenantId, id);
  }

  @Post(":id/resolve")
  @Header("Cache-Control", "no-store")
  async resolve(
    @Req() request: Request & { user: JwtPayload },
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveIdentityDto,
  ) {
    const tenantId = await this.prisma.$transaction(tx => this.identities.actorScope(tx, request.user.sub));
    return {
      value: await this.identities.resolve(
        request.user.sub,
        tenantId,
        id,
        dto.purpose,
        dto.caseReference,
      ),
    };
  }
}
