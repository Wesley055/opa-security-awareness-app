import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ListFacilityIncidentsDto } from './dto/list-facility-incidents.dto';
import { FacilitiesService } from './facilities.service';
import { OperatorFacilityGuard } from './guards/operator-facility.guard';
import type { OperatorQueueRequest } from './guards/operator-facility.guard';

/**
 * The signed-in operator's own incident queue.
 *
 * IT LIVES UNDER modules/facilities WHILE SERVING /operator/incidents, which
 * reads oddly and is deliberate: FacilitiesService is already provided here
 * and the queue logic is entirely reused, so a separate module would add a
 * file and an app.module.ts edit to change nothing about behaviour.
 *
 * NOTE that apps/website also serves a page at /operator. Different hosts,
 * no relationship - the console is same-origin with the website and never
 * calls this path directly. Do not infer one from the other.
 *
 * THE FACILITY IS NEVER IN THE REQUEST. OperatorFacilityGuard reads it from
 * the caller's row and attaches it. That is the whole point of the route
 * existing alongside /facilities/:facilityId/incidents: the browser does not
 * need to know, send, or be trusted with a facility id.
 *
 * ListFacilityIncidentsDto IS REUSED UNCHANGED. status, the opaque cursor
 * and take mean exactly the same thing whether the facility came from a URL
 * segment or from the token. A parallel DTO would be two queue contracts
 * free to drift.
 */
@UseGuards(JwtAuthGuard, OperatorFacilityGuard)
@Controller('operator')
export class OperatorIncidentsController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  @Get('incidents')
  listMyQueue(
    @Req() request: OperatorQueueRequest,
    @Query() query: ListFacilityIncidentsDto,
  ) {
    return this.facilitiesService.listIncidentsForFacility(
      request.operatorFacilityId,
      query,
    );
  }
}