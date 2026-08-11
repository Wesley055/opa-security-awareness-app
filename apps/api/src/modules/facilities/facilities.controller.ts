import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FacilityOperatorGuard } from './guards/facility-operator.guard';
import { FacilitiesService } from './facilities.service';

@UseGuards(JwtAuthGuard, FacilityOperatorGuard)
@Controller('facilities')
export class FacilitiesController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  @Get(':facilityId/incidents')
  listIncidents(@Param('facilityId') facilityId: string) {
    return this.facilitiesService.listIncidentsForFacility(facilityId);
  }
}