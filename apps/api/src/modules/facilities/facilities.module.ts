import { Module } from '@nestjs/common';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesService } from './facilities.service';
import { FacilityOperatorGuard } from './guards/facility-operator.guard';

@Module({
  controllers: [FacilitiesController],
  providers: [FacilitiesService, FacilityOperatorGuard],
  exports: [FacilitiesService],
})
export class FacilitiesModule {}