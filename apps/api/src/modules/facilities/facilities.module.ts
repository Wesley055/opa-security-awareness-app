import { Module } from '@nestjs/common';
import { AdminProvisioningModule } from '../admin-provisioning/admin-provisioning.module';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesService } from './facilities.service';
import { FacilityAdminGuard } from './guards/facility-admin.guard';
import { FacilityOperatorGuard } from './guards/facility-operator.guard';
import { OperatorFacilityGuard } from './guards/operator-facility.guard';
import { OperatorIncidentsController } from './operator-incidents.controller';
import { OperatorMembersController } from './operator-members.controller';
import { FacilityAdminResidentProvisioningController } from './facility-admin-resident-provisioning.controller';

@Module({
  imports: [AdminProvisioningModule],
  controllers: [
    FacilitiesController,
    OperatorIncidentsController,
    OperatorMembersController,
    FacilityAdminResidentProvisioningController,
  ],
  providers: [
    FacilitiesService,
    FacilityAdminGuard,
    FacilityOperatorGuard,
    OperatorFacilityGuard,
  ],
  exports: [FacilitiesService],
})
export class FacilitiesModule {}