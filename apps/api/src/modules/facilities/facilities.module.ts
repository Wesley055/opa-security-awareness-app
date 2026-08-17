import { Module } from '@nestjs/common';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesService } from './facilities.service';
import { FacilityOperatorGuard } from './guards/facility-operator.guard';
import { OperatorFacilityGuard } from './guards/operator-facility.guard';
import { OperatorIncidentsController } from './operator-incidents.controller';
import { OperatorMembersController } from './operator-members.controller';

@Module({
  controllers: [
    FacilitiesController,
    OperatorIncidentsController,
    OperatorMembersController,
  ],
  providers: [
    FacilitiesService,
    FacilityOperatorGuard,
    OperatorFacilityGuard,
  ],
  exports: [FacilitiesService],
})
export class FacilitiesModule {}