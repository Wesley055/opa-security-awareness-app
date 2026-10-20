import { ApiExcludeController } from "@nestjs/swagger";
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OperatorFacilityGuard, type OperatorQueueRequest } from "../facilities/guards/operator-facility.guard";
import { FacilityAdminGuard, type FacilityAdminRequest } from "../facilities/guards/facility-admin.guard";
import { DutyService } from "./duty.service";

export class HandoverItemDto {
  @IsString() @MaxLength(500) text!: string;
  @IsIn(["HANDOVER", "UNRESOLVED", "OBSERVATION"]) category!: "HANDOVER" | "UNRESOLVED" | "OBSERVATION";
}
export class SubmitDutyReportDto {
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => HandoverItemDto) handoverItems?: HandoverItemDto[];
}

/** Operators: their own duty shifts and reports. Never part of any SOS path. */
@Controller("operator/duty")
@ApiExcludeController()
@UseGuards(JwtAuthGuard, OperatorFacilityGuard)
export class OperatorDutyController {
  constructor(private readonly duty: DutyService) {}

  @Get() @Header("Cache-Control", "no-store")
  current(@Req() req: OperatorQueueRequest) { return this.duty.current(req.user.sub); }

  @Post("start") @HttpCode(200)
  start(@Req() req: OperatorQueueRequest) { return this.duty.start(req.user.sub); }

  @Get("preview") @Header("Cache-Control", "no-store")
  preview(@Req() req: OperatorQueueRequest) { return this.duty.preview(req.user.sub); }

  @Post("submit") @HttpCode(200)
  submit(@Req() req: OperatorQueueRequest, @Body() dto: SubmitDutyReportDto) { return this.duty.submit(req.user.sub, dto); }

  @Post("shifts/:shiftId/submit") @HttpCode(200)
  submitLate(@Req() req: OperatorQueueRequest, @Param("shiftId", ParseUUIDPipe) shiftId: string, @Body() dto: SubmitDutyReportDto) {
    return this.duty.submit(req.user.sub, dto, shiftId);
  }

  @Get("reports") @Header("Cache-Control", "no-store")
  mine(@Req() req: OperatorQueueRequest) { return this.duty.list(req.user.sub, req.operatorFacilityId, true); }

  @Get("reports/:id") @Header("Cache-Control", "no-store")
  readMine(@Req() req: OperatorQueueRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.duty.read(req.user.sub, req.operatorFacilityId, id, true);
  }
}

/** Facility Admins: review and acknowledge Duty Reports (Reports / Analytics). */
@Controller("facility-admin/duty-reports")
@ApiExcludeController()
@UseGuards(JwtAuthGuard, FacilityAdminGuard)
export class AdminDutyController {
  constructor(private readonly duty: DutyService) {}

  @Get() @Header("Cache-Control", "no-store")
  list(@Req() req: FacilityAdminRequest) { return this.duty.list(req.user.sub, req.facilityAdminFacilityId, false); }

  @Get(":id") @Header("Cache-Control", "no-store")
  read(@Req() req: FacilityAdminRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.duty.read(req.user.sub, req.facilityAdminFacilityId, id, false);
  }

  @Post(":id/acknowledge") @HttpCode(200)
  acknowledge(@Req() req: FacilityAdminRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.duty.acknowledge(req.user.sub, req.facilityAdminFacilityId, id);
  }
}
