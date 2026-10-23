import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsString, Matches } from "class-validator";
import type { Request } from "express";
import type { JwtPayload } from "../auth/jwt.strategy";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SafeWalkGuardianService } from "./safewalk-guardian.service";

class AuthorizeGuardianDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  code!: string;
}
type AuthRequest = Request & { user: JwtPayload };
const uuid = new ParseUUIDPipe({ version: "4" });

@Controller("safewalk")
@UseGuards(JwtAuthGuard)
export class SafeWalkGuardianController {
  constructor(private readonly guardians: SafeWalkGuardianService) {}

  @Post("guardian-code")
  issue(@Req() req: AuthRequest) {
    return this.guardians.issueCode(req.user.sub);
  }

  @Post("sessions/:sessionId/guardians")
  authorize(
    @Req() req: AuthRequest,
    @Param("sessionId", uuid) sessionId: string,
    @Body() dto: AuthorizeGuardianDto,
  ) {
    return this.guardians.authorize(req.user.sub, sessionId, dto.code);
  }

  @Post("sessions/:sessionId/guardians/:grantId/revoke")
  revoke(
    @Req() req: AuthRequest,
    @Param("sessionId", uuid) sessionId: string,
    @Param("grantId", uuid) grantId: string,
  ) {
    return this.guardians.revoke(req.user.sub, sessionId, grantId);
  }

  @Get("sessions/:sessionId/shared")
  shared(@Req() req: AuthRequest, @Param("sessionId", uuid) sessionId: string) {
    return this.guardians.sharedStatus(req.user.sub, sessionId);
  }

  @Get("notices")
  inbox(@Req() req: AuthRequest) {
    return this.guardians.inbox(req.user.sub);
  }

  @Post("notices/:noticeId/acknowledge")
  acknowledge(
    @Req() req: AuthRequest,
    @Param("noticeId", uuid) noticeId: string,
  ) {
    return this.guardians.acknowledge(req.user.sub, noticeId);
  }
}
