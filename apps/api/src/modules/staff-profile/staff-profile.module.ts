import { Module } from "@nestjs/common";
import { StaffPhotoReviewController, StaffProfileController } from "./staff-profile.controller";
import { StaffProfileService } from "./staff-profile.service";
import { FacilityAdminGuard } from "../facilities/guards/facility-admin.guard";

@Module({
  controllers: [StaffProfileController, StaffPhotoReviewController],
  providers: [StaffProfileService, FacilityAdminGuard],
})
export class StaffProfileModule {}
