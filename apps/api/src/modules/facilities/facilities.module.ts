import { Module } from '@nestjs/common';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesService } from './facilities.service';
import { FacilityStaffGuard } from './guards/facility-staff.guard';

@Module({
  controllers: [FacilitiesController],
  providers: [FacilitiesService, FacilityStaffGuard],
  exports: [FacilitiesService],
})
export class FacilitiesModule {}