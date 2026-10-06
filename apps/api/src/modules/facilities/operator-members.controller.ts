import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ReaderPageDto } from '../../shared/dto/reader-page.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FacilitiesService } from './facilities.service';
import { OperatorFacilityGuard } from './guards/operator-facility.guard';
import type { OperatorQueueRequest } from './guards/operator-facility.guard';

/** Retain the legacy route as an explicit denial; Operators use incident-scoped identity only. */
@UseGuards(JwtAuthGuard, OperatorFacilityGuard)
@Controller('operator/facility')
export class OperatorMembersController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  @Get('members')
  listMyFacilityMembers(@Req() request: OperatorQueueRequest, @Query() query: ReaderPageDto = {}) {
    void request;
    void query;
    throw new ForbiddenException("Operators do not have facility directory access. Use authorized incident context.");
  }
}
