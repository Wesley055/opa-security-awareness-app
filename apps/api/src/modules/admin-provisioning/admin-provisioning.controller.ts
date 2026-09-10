import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { JwtPayload } from "../auth/jwt.strategy";
import { AdminGuard } from "../../shared/guards/admin.guard";
import { AdminProvisioningService } from "./admin-provisioning.service";
import { PlatformAdminService } from "./platform-admin.service";
import { CreateFacilityDto } from "./dto/create-facility.dto";
import { CreateOperatorDto } from "./dto/create-operator.dto";

class PageDto {
  @IsOptional() @IsUUID() cursor?: string;
}
class ReasonDto {
  @IsString() @Length(1, 500) reason!: string;
}
class MembershipActionDto extends ReasonDto {
  @IsIn(["suspend", "reactivate", "revoke"]) action!:
    "suspend" | "reactivate" | "revoke";
}
type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin")
export class AdminProvisioningController {
  constructor(
    private readonly provisioning: AdminProvisioningService,
    private readonly platform: PlatformAdminService,
  ) {}
  @Post("facilities")
  @Header("Cache-Control", "no-store")
  createFacility(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateFacilityDto,
  ) {
    return this.provisioning.createFacility(dto, req.user.sub);
  }
  @Get("facilities")
  @Header("Cache-Control", "no-store")
  facilities(@Req() req: AuthenticatedRequest, @Query() query: PageDto) {
    return this.platform.directory(req.user.sub, query.cursor);
  }
  @Get("facilities/:facilityId")
  @Header("Cache-Control", "no-store")
  detail(
    @Req() req: AuthenticatedRequest,
    @Param("facilityId", ParseUUIDPipe) id: string,
  ) {
    return this.platform.detail(req.user.sub, id);
  }
  @Get("facilities/:facilityId/members")
  @Header("Cache-Control", "no-store")
  members(
    @Req() req: AuthenticatedRequest,
    @Param("facilityId", ParseUUIDPipe) id: string,
    @Query() query: PageDto,
  ) {
    return this.platform.members(req.user.sub, id, query.cursor);
  }
  @Post("operators")
  @Header("Cache-Control", "no-store")
  operator(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateOperatorDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.platform.invite(req.user.sub, dto, key, "FACILITY_OPERATOR");
  }
  @Post("facility-admins")
  @Header("Cache-Control", "no-store")
  facilityAdmin(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateOperatorDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.platform.invite(req.user.sub, dto, key, "FACILITY_ADMIN");
  }
  @Post("residents")
  @Header("Cache-Control", "no-store")
  resident(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateOperatorDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.platform.invite(req.user.sub, dto, key, "USER");
  }
  @Get("facilities/:facilityId/invitations")
  @Header("Cache-Control", "no-store")
  invitations(
    @Req() req: AuthenticatedRequest,
    @Param("facilityId", ParseUUIDPipe) id: string,
    @Query() query: PageDto,
  ) {
    return this.platform.invitations(req.user.sub, id, query.cursor);
  }
  @Post("facilities/:facilityId/invitations/:id/resend")
  @Header("Cache-Control", "no-store")
  resend(
    @Req() req: AuthenticatedRequest,
    @Param("facilityId", ParseUUIDPipe) facility: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.platform.invitationAction(
      req.user.sub,
      facility,
      id,
      "resend",
      dto.reason,
    );
  }
  @Post("facilities/:facilityId/invitations/:id/revoke")
  @Header("Cache-Control", "no-store")
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param("facilityId", ParseUUIDPipe) facility: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.platform.invitationAction(
      req.user.sub,
      facility,
      id,
      "revoke",
      dto.reason,
    );
  }
  @Post("facilities/:facilityId/members/:id/access")
  @Header("Cache-Control", "no-store")
  access(
    @Req() req: AuthenticatedRequest,
    @Param("facilityId", ParseUUIDPipe) facility: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MembershipActionDto,
  ) {
    return this.platform.membershipAction(
      req.user.sub,
      facility,
      id,
      dto.action,
      dto.reason,
    );
  }
  @Get("facilities/:facilityId/audit")
  @Header("Cache-Control", "no-store")
  audit(
    @Req() req: AuthenticatedRequest,
    @Param("facilityId", ParseUUIDPipe) id: string,
    @Query() query: PageDto,
  ) {
    return this.platform.audit(req.user.sub, id, query.cursor);
  }
}
