import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ListFacilityIncidentsDto } from './dto/list-facility-incidents.dto';
import { FacilityOperatorGuard } from './guards/facility-operator.guard';
import { FacilitiesService } from './facilities.service';

@UseGuards(JwtAuthGuard, FacilityOperatorGuard)
@Controller('facilities')
export class FacilitiesController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  /**
   * The operator queue.
   *
   * FacilityOperatorGuard has already established that the caller belongs
   * to :facilityId, or is an admin. The service does not re-check that;
   * it must not be called from anywhere the guard is absent.
   */
  @Get(':facilityId/incidents')
  listIncidents(
    @Param('facilityId') facilityId: string,
    @Query() query: ListFacilityIncidentsDto,
  ) {
    return this.facilitiesService.listIncidentsForFacility(facilityId, query);
  }
}