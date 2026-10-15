import { Module } from "@nestjs/common";
import { InsightController } from "./insight.controller";
import { InsightService } from "./insight.service";
import { InsightReportWorker } from "./insight-report.worker";
import { InsightGuard } from "./insight.guard";
import { AdminGuard } from "../../shared/guards/admin.guard";
import { OperatorFacilityGuard } from "../facilities/guards/operator-facility.guard";
import { FacilityAdminGuard } from "../facilities/guards/facility-admin.guard";
@Module({
  controllers: [InsightController],
  providers: [
    InsightService,
    InsightReportWorker,
    InsightGuard,
    AdminGuard,
    OperatorFacilityGuard,
    FacilityAdminGuard,
  ],
  exports: [InsightService],
})
export class InsightModule {}
