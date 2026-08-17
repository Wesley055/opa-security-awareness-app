import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FacilitiesService } from './facilities.service';
import { OperatorFacilityGuard } from './guards/operator-facility.guard';
import type { OperatorQueueRequest } from './guards/operator-facility.guard';

/**
 * The membership of the signed-in operator's own estate.
 *
 * IT LIVES UNDER modules/facilities WHILE SERVING /operator/facility, for the
 * same reason operator-incidents.controller.ts does: FacilitiesService is
 * already provided here and a separate module would add a file and an
 * app.module.ts edit to change nothing about behaviour.
 *
 * THE FACILITY ID IS NEVER ACCEPTED FROM THE BROWSER. OperatorFacilityGuard
 * re-reads the caller's row and attaches the authoritative id, matching the
 * /operator/incidents boundary exactly.
 *
 * BOTH GUARDS ARE CLASS-LEVEL, DELIBERATELY. controller-guard-attachment.
 * spec.ts reads GUARDS_METADATA off the CLASS and cannot see a method-level
 * @UseGuards - trap #191. A method-level guard here would be a correct guard
 * on an endpoint the suite reports as unprotected.
 *
 * The service projection deliberately excludes email and phoneNumber.
 */
@UseGuards(JwtAuthGuard, OperatorFacilityGuard)
@Controller('operator/facility')
export class OperatorMembersController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  @Get('members')
  listMyFacilityMembers(@Req() request: OperatorQueueRequest) {
    return this.facilitiesService.listMembersForOperator(
      request.operatorFacilityId,
    );
  }
}
