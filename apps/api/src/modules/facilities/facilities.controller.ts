import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FacilityStaffGuard } from './guards/facility-staff.guard';
import { FacilitiesService } from './facilities.service';

@UseGuards(JwtAuthGuard, FacilityStaffGuard)
@Controller('facilities')
export class FacilitiesController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  @Get(':facilityId/incidents')
  listIncidents(@Param('facilityId') facilityId: string) {
    return this.facilitiesService.listIncidentsForFacility(facilityId);
  }
}