import { Module } from "@nestjs/common";
import { StaffPhotoReviewController, StaffProfileController } from "./staff-profile.controller";
import { StaffProfileService } from "./staff-profile.service";
import { FacilityAdminGuard } from "../facilities/guards/facility-admin.guard";
import { EmailProvider } from "../notifications/providers/email.provider";
import { SmsProvider } from "../notifications/providers/sms.provider";

@Module({
  controllers: [StaffProfileController, StaffPhotoReviewController],
  providers: [StaffProfileService, FacilityAdminGuard, SmsProvider, EmailProvider],
})
export class StaffProfileModule {}
