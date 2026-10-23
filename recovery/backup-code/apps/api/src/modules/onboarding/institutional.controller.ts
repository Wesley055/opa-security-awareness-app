import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import { SupportCapability } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AdminGuard } from "../../shared/guards/admin.guard";
import { InstitutionalService } from "./institutional.service";
import type { JwtPayload } from "../auth/jwt.strategy";
class DiscoveryDto {
  @IsOptional() @IsUUID() cursor?: string;
}
class EligibilityDto {
  @IsOptional() @IsUUID() caseReference?: string;
}
class ContextDto {
  @IsString() @Length(1, 500) reason!: string;
  @IsUUID() caseReference!: string;
  @IsUUID() correlationId!: string;
}
class EmploymentDto extends ContextDto {
  @IsIn(["ACTIVE", "SUSPENDED", "ENDED"]) state!:
    "ACTIVE" | "SUSPENDED" | "ENDED";
}
class GrantDto extends ContextDto {
  @IsEnum(SupportCapability) capability!: SupportCapability;
  @IsOptional() @IsUUID() facilityId?: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
}
class MembershipDto extends ContextDto {
  @IsIn(["suspend", "revoke", "restore", "recover"]) action!:
    "suspend" | "revoke" | "restore" | "recover";
}
class InviteDto extends ContextDto {
  @IsEmail() email!: string;
  @IsString() @Length(8, 25) phoneNumber!: string;
  @IsString() @Length(1, 100) firstName!: string;
  @IsString() @Length(1, 100) lastName!: string;
  @IsIn(["USER", "FACILITY_ADMIN", "FACILITY_OPERATOR"]) role!:
    "USER" | "FACILITY_ADMIN" | "FACILITY_OPERATOR";
}
class FirstFacilityAdminDto {
  @IsString() @Length(1, 500) reason!: string;
  @IsUUID() correlationId!: string;
  // OperationStore supplies a correlation reference; it is never treated as a Support Case here.
  @IsOptional() @IsUUID() caseReference?: string;
  @IsEmail() email!: string;
  @IsString() @Length(8, 25) phoneNumber!: string;
  @IsString() @Length(1, 100) firstName!: string;
  @IsString() @Length(1, 100) lastName!: string;
}
class SupportInviteDto extends ContextDto {
  @IsEmail() email!: string;
  @IsString() @Length(8, 25) phoneNumber!: string;
  @IsString() @Length(1, 100) firstName!: string;
  @IsString() @Length(1, 100) lastName!: string;
}
class InvitationActionDto extends ContextDto {
  @IsIn(["resend", "revoke"]) action!: "resend" | "revoke";
}
class FacilityStateDto extends ContextDto {
  @IsIn(["suspend", "reactivate"]) action!: "suspend" | "reactivate";
}
type Request = { user: JwtPayload };
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/support")
export class SupportAdministrationController {
  constructor(private readonly service: InstitutionalService) {}
  @Get("readiness") readiness(@Req() req: Request) {
    return this.service.deliveryReadiness(req.user.sub);
  }
  @Post("invitations/:id/action") invitationAction(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: InvitationActionDto,
  ) {
    return this.service.supportInvitationAction(
      req.user.sub,
      id,
      dto.action,
      dto,
    );
  }

  @Get("accounts") accounts(@Req() req: Request, @Query() query: DiscoveryDto) {
    return this.service.recoveryAccounts(req.user.sub, query.cursor);
  }
  @Get("employees") employees(@Req() req: Request) {
    return this.service.supportDirectory(req.user.sub);
  }
  @Get("operations/:id") operation(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.supportOperation(req.user.sub, id);
  }
  @Post("employees/:id/revoke-all") revokeAll(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ContextDto,
  ) {
    return this.service.revokeSupportGrants(req.user.sub, id, dto);
  }
  @Post("accounts/:id/recover") recover(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ContextDto,
  ) {
    return this.service.recoverAccount(req.user.sub, id, dto);
  }
  @Post("invitations") invite(
    @Req() req: Request,
    @Body() dto: SupportInviteDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.invite(
      req.user.sub,
      undefined,
      "TECHNICAL_SUPPORT",
      dto,
      key,
      dto,
    );
  }
  @Post("employees/:id/employment") employment(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: EmploymentDto,
  ) {
    return this.service.employment(req.user.sub, id, dto.state, dto);
  }
  @Post("employees/:id/grants") grant(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GrantDto,
  ) {
    return this.service.grant(
      req.user.sub,
      id,
      dto.capability,
      dto.facilityId ?? null,
      dto.expiresAt,
      dto,
    );
  }
  @Post("grants/:id/revoke") revoke(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ContextDto,
  ) {
    return this.service.revokeGrant(req.user.sub, id, dto);
  }
  @Post("facilities/:id/state") facility(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: FacilityStateDto,
  ) {
    return this.service.facilityState(req.user.sub, id, dto.action, dto);
  }
}
@UseGuards(JwtAuthGuard)
@Controller("institutional")
export class InstitutionalController {
  constructor(private readonly service: InstitutionalService) {}
  @Get("facilities/:facilityId/first-facility-admin")
  firstFacilityAdminEligibility(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) facilityId: string,
  ) {
    return this.service.firstFacilityAdminEligibility(req.user.sub, facilityId);
  }
  @Post("facilities/:facilityId/first-facility-admin")
  firstFacilityAdmin(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) facilityId: string,
    @Body() dto: FirstFacilityAdminDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.firstFacilityAdmin(
      req.user.sub,
      facilityId,
      dto,
      key,
      dto,
    );
  }
  @Get("facilities/:facilityId/invitation-roles") invitationRoles(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) facilityId: string,
    @Query() query: EligibilityDto,
  ) {
    return this.service.invitationRoles(
      req.user.sub,
      facilityId,
      query.caseReference,
    );
  }
  @Get("readiness") readiness(@Req() req: Request) {
    return this.service.deliveryReadiness(req.user.sub);
  }
  @Get("context") context(@Req() req: Request) {
    return this.service.context(req.user.sub);
  }
  @Get("facilities") directory(@Req() req: Request) {
    return this.service.directory(req.user.sub);
  }
  @Get("health") health(@Req() req: Request) {
    return this.service.health(req.user.sub);
  }
  @Get("facilities/:facilityId/members") members(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) id: string,
  ) {
    return this.service.members(req.user.sub, id);
  }
  @Post("facilities/:facilityId/invitations") invite(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) id: string,
    @Body() dto: InviteDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.invite(req.user.sub, id, dto.role, dto, key, dto);
  }
  @Post("facilities/:facilityId/members/:id/access") access(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) facility: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MembershipDto,
  ) {
    return this.service.membership(req.user.sub, facility, id, dto.action, dto);
  }
  @Get("facilities/:facilityId/enrollments") enrollments(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) id: string,
  ) {
    return this.service.diagnostics(req.user.sub, id, "enrollments");
  }
  @Get("facilities/:facilityId/delivery") delivery(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) id: string,
  ) {
    return this.service.diagnostics(req.user.sub, id, "delivery");
  }
  @Get("facilities/:facilityId/audit") audit(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) id: string,
  ) {
    return this.service.diagnostics(req.user.sub, id, "audit");
  }
  @Get("facilities/:facilityId/command-center") commandCenter(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) id: string,
  ) {
    return this.service.commandCenter(req.user.sub, id);
  }
  @Get("facilities/:facilityId/safewalk-emergencies") safeWalkEmergencies(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) id: string,
    @Query() query: EligibilityDto,
  ) {
    return this.service.safeWalkEmergencies(
      req.user.sub,
      id,
      query.caseReference,
    );
  }
  @Get("facilities/:facilityId/incidents") incidents(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) id: string,
  ) {
    return this.service.incidents(req.user.sub, id);
  }
  @Post("facilities/:facilityId/invitations/:id/action") invitationAction(
    @Req() req: Request,
    @Param("facilityId", ParseUUIDPipe) facility: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: InvitationActionDto,
  ) {
    return this.service.invitationAction(
      req.user.sub,
      facility,
      id,
      dto.action,
      dto,
    );
  }
}
