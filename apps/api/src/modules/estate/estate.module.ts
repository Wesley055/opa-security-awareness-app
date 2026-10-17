import { Module } from "@nestjs/common";
import { EstateAdminController, GateController, ResidentPassController } from "./estate.controller";
import { EstateService } from "./estate.service";
import { EstateWorker } from "./estate.worker";
import { OperatorFacilityGuard } from "../facilities/guards/operator-facility.guard";
import { FacilityAdminGuard } from "../facilities/guards/facility-admin.guard";

@Module({
  controllers: [ResidentPassController, GateController, EstateAdminController],
  providers: [EstateService, EstateWorker, OperatorFacilityGuard, FacilityAdminGuard],
  exports: [EstateService],
})
export class EstateModule {}
