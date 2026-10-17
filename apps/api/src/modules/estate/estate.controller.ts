import { ApiExcludeController } from "@nestjs/swagger";
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import type { JwtPayload } from "../auth/jwt.strategy";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OperatorFacilityGuard, type OperatorQueueRequest } from "../facilities/guards/operator-facility.guard";
import { FacilityAdminGuard, type FacilityAdminRequest } from "../facilities/guards/facility-admin.guard";
import { EstateService } from "./estate.service";
import { CreateVisitorPassDto, EstateSettingsDto, GateCodeDto, GateDenyDto, GatePassDto, ManualEntryDto } from "./estate.dto";

type AuthRequest = Request & { user: JwtPayload };

/** Residents: their own visitor passes. Residency is re-checked in the service. */
@Controller("estate/passes")
@ApiExcludeController()
@UseGuards(JwtAuthGuard)
export class ResidentPassController {
  constructor(private readonly estate: EstateService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  mine(@Req() req: AuthRequest) {
    return this.estate.myPasses(req.user.sub);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  create(@Req() req: AuthRequest, @Body() dto: CreateVisitorPassDto) {
    return this.estate.createPass(req.user.sub, dto);
  }

  @Post(":id/code")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  newCode(@Req() req: AuthRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.estate.newCode(req.user.sub, id);
  }

  @Post(":id/revoke")
  @HttpCode(200)
  revoke(@Req() req: AuthRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.estate.revoke(req.user.sub, id);
  }
}

/** Gate security: the estate's Operator accounts, for their own estate only. */
@Controller("estate/gate")
@ApiExcludeController()
@UseGuards(JwtAuthGuard, OperatorFacilityGuard)
export class GateController {
  constructor(private readonly estate: EstateService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  board(@Req() req: OperatorQueueRequest) {
    return this.estate.gateBoard(req.operatorFacilityId);
  }

  @Post("verify")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  verify(@Req() req: OperatorQueueRequest, @Body() dto: GateCodeDto) {
    return this.estate.verify(req.user.sub, req.operatorFacilityId, dto.code);
  }

  @Post("admit")
  @HttpCode(200)
  admit(@Req() req: OperatorQueueRequest, @Body() dto: GatePassDto) {
    return this.estate.admit(req.user.sub, req.operatorFacilityId, dto.passId);
  }

  @Post("deny")
  @HttpCode(200)
  deny(@Req() req: OperatorQueueRequest, @Body() dto: GateDenyDto) {
    return this.estate.deny(req.user.sub, req.operatorFacilityId, dto.passId, dto.reason);
  }

  @Post("exit")
  @HttpCode(200)
  exit(@Req() req: OperatorQueueRequest, @Body() dto: GatePassDto) {
    return this.estate.exit(req.user.sub, req.operatorFacilityId, dto.passId);
  }

  @Post("manual-entry")
  @HttpCode(200)
  manual(@Req() req: OperatorQueueRequest, @Body() dto: ManualEntryDto) {
    return this.estate.manualEntry(req.user.sub, req.operatorFacilityId, dto.note);
  }

  @Get("incidents/:incidentId/visitors")
  @Header("Cache-Control", "no-store")
  incidentVisitors(@Req() req: OperatorQueueRequest, @Param("incidentId", ParseUUIDPipe) incidentId: string) {
    return this.estate.incidentVisitors(req.operatorFacilityId, incidentId);
  }
}

/** Estate management: the facility admin's overview and visitor settings. */
@Controller("estate/admin")
@ApiExcludeController()
@UseGuards(JwtAuthGuard, FacilityAdminGuard)
export class EstateAdminController {
  constructor(private readonly estate: EstateService) {}

  @Get("overview")
  @Header("Cache-Control", "no-store")
  overview(@Req() req: FacilityAdminRequest) {
    return this.estate.overview(req.facilityAdminFacilityId);
  }

  @Put("settings")
  settings(@Req() req: FacilityAdminRequest, @Body() dto: EstateSettingsDto) {
    return this.estate.updateSettings(req.facilityAdminFacilityId, dto);
  }
}
