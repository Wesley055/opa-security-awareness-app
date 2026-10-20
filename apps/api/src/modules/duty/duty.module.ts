import { Module } from "@nestjs/common";
import { AdminDutyController, OperatorDutyController } from "./duty.controller";
import { DutyService } from "./duty.service";
import { DutyWorker } from "./duty.worker";
import { OperatorFacilityGuard } from "../facilities/guards/operator-facility.guard";
import { FacilityAdminGuard } from "../facilities/guards/facility-admin.guard";
import { EmailProvider } from "../notifications/providers/email.provider";

@Module({
  controllers: [OperatorDutyController, AdminDutyController],
  providers: [DutyService, DutyWorker, OperatorFacilityGuard, FacilityAdminGuard, EmailProvider],
  exports: [DutyService],
})
export class DutyModule {}
