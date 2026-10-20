import { ApiExcludeController } from "@nestjs/swagger";
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { IsString, MinLength } from "class-validator";
import type { Request } from "express";
import type { JwtPayload } from "../auth/jwt.strategy";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { FacilityAdminGuard, type FacilityAdminRequest } from "../facilities/guards/facility-admin.guard";
import { IsNewPassword } from "../../shared/security/password-policy";
import { MAX_PHOTO_BYTES, StaffProfileService } from "./staff-profile.service";

export class ChangePasswordDto {
  @IsString() @MinLength(1) currentPassword!: string;
  @IsNewPassword() newPassword!: string;
}

type AuthRequest = Request & { user: JwtPayload };

/** My profile: every institutional staff member. Role is re-checked in the service. */
@Controller("staff/profile")
@ApiExcludeController()
@UseGuards(JwtAuthGuard)
export class StaffProfileController {
  constructor(private readonly profiles: StaffProfileService) {}

  @Get() @Header("Cache-Control", "no-store")
  me(@Req() req: AuthRequest) { return this.profiles.me(req.user.sub); }

  @Post("photo") @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_PHOTO_BYTES } }))
  photo(@Req() req: AuthRequest, @UploadedFile() file: { buffer: Buffer; size: number } | undefined) {
    return this.profiles.uploadPhoto(req.user.sub, file);
  }

  @Post("password") @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  password(@Req() req: AuthRequest, @Body() dto: ChangePasswordDto) {
    return this.profiles.changePassword(req.user.sub, dto.currentPassword, dto.newPassword);
  }

  @Post("sign-out-everywhere") @HttpCode(200)
  signOutEverywhere(@Req() req: AuthRequest) { return this.profiles.signOutEverywhere(req.user.sub); }
}

/** Facility Admin: approve or reject operator photos for their facility. */
@Controller("facility-admin/staff-photos")
@ApiExcludeController()
@UseGuards(JwtAuthGuard, FacilityAdminGuard)
export class StaffPhotoReviewController {
  constructor(private readonly profiles: StaffProfileService) {}

  @Get() @Header("Cache-Control", "no-store")
  pending(@Req() req: FacilityAdminRequest) { return this.profiles.pendingPhotos(req.facilityAdminFacilityId); }

  @Post(":userId/approve") @HttpCode(200)
  approve(@Req() req: FacilityAdminRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.profiles.reviewPhoto(req.user.sub, req.facilityAdminFacilityId, userId, true);
  }

  @Post(":userId/reject") @HttpCode(200)
  reject(@Req() req: FacilityAdminRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.profiles.reviewPhoto(req.user.sub, req.facilityAdminFacilityId, userId, false);
  }
}
