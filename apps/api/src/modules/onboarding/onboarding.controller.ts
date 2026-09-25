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
import {
  IsDateString,
  IsString,
  IsUUID,
  IsOptional,
  Length,
} from "class-validator";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { JwtPayload } from "../auth/jwt.strategy";
import { AdminGuard } from "../../shared/guards/admin.guard";
import { CreateOperatorDto } from "../admin-provisioning/dto/create-operator.dto";
import { OnboardingService } from "./onboarding.service";
type AuthRequest = Request & { user: JwtPayload };
class PageDto {
  @IsOptional() @IsUUID() cursor?: string;
}
class ReasonDto {
  @IsString() @Length(1, 500) reason!: string;
}
class GrantDto extends ReasonDto {
  @IsUUID() facilityId!: string;
  @IsDateString() expiresAt!: string;
}

@Controller("admin/onboarding")
@UseGuards(JwtAuthGuard, AdminGuard)
export class OnboardingGrantsController {
  constructor(private readonly service: OnboardingService) {}
  @Get("employees")
  @Header("Cache-Control", "no-store")
  employees(@Req() req: AuthRequest, @Query() query: PageDto) {
    return this.service.employees(req.user.sub, query.cursor);
  }
  @Get("employees/:employeeId/grants")
  @Header("Cache-Control", "no-store")
  grants(
    @Req() req: AuthRequest,
    @Param("employeeId", ParseUUIDPipe) employee: string,
    @Query() query: PageDto,
  ) {
    return this.service.grants(req.user.sub, employee, query.cursor);
  }
  @Post("employees/:employeeId/grants")
  @Header("Cache-Control", "no-store")
  grant(
    @Req() req: AuthRequest,
    @Param("employeeId", ParseUUIDPipe) employee: string,
    @Body() dto: GrantDto,
  ) {
    return this.service.grant(
      req.user.sub,
      employee,
      dto.facilityId,
      dto.expiresAt,
      dto.reason,
    );
  }
  @Post("employees/:employeeId/grants/:id/revoke")
  @Header("Cache-Control", "no-store")
  revoke(
    @Req() req: AuthRequest,
    @Param("employeeId", ParseUUIDPipe) employee: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.service.revoke(req.user.sub, employee, dto.reason, id);
  }
  @Post("employees/:employeeId/revoke-all")
  @Header("Cache-Control", "no-store")
  revokeAll(
    @Req() req: AuthRequest,
    @Param("employeeId", ParseUUIDPipe) employee: string,
    @Body() dto: ReasonDto,
  ) {
    return this.service.revoke(req.user.sub, employee, dto.reason);
  }
}

// No role from the JWT is used for authorization. Every service operation
// checks current PostgreSQL authority inside its transaction.
@Controller("onboarding")
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}
  @Get("facilities")
  @Header("Cache-Control", "no-store")
  facilities(@Req() req: AuthRequest, @Query() query: PageDto) {
    return this.service.facilities(req.user.sub, query.cursor);
  }
  @Post("operators")
  @Header("Cache-Control", "no-store")
  operators(
    @Req() req: AuthRequest,
    @Body() dto: CreateOperatorDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.invite(req.user.sub, dto, key, "FACILITY_OPERATOR");
  }
  @Post("facility-admins")
  @Header("Cache-Control", "no-store")
  admins(
    @Req() req: AuthRequest,
    @Body() dto: CreateOperatorDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.invite(req.user.sub, dto, key, "FACILITY_ADMIN");
  }
  @Get("facilities/:facilityId/invitations")
  @Header("Cache-Control", "no-store")
  invitations(
    @Req() req: AuthRequest,
    @Param("facilityId", ParseUUIDPipe) facility: string,
    @Query() query: PageDto,
  ) {
    return this.service.invitations(req.user.sub, facility, query.cursor);
  }
  @Post("facilities/:facilityId/invitations/:id/resend")
  @Header("Cache-Control", "no-store")
  resend(
    @Req() req: AuthRequest,
    @Param("facilityId", ParseUUIDPipe) facility: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.service.invitationAction(
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
    @Req() req: AuthRequest,
    @Param("facilityId", ParseUUIDPipe) facility: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.service.invitationAction(
      req.user.sub,
      facility,
      id,
      "revoke",
      dto.reason,
    );
  }
}
