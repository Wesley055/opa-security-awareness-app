import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { AdminProvisioningService } from './admin-provisioning.service';
import { AssignResidentFacilityDto } from './dto/assign-resident-facility.dto';
import { CreateFacilityDto } from './dto/create-facility.dto';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { CreateBulkResidentsDto } from './dto/create-bulk-residents.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { FindResidentDto } from './dto/find-resident.dto';

type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminProvisioningController {
  constructor(
    private readonly provisioning: AdminProvisioningService,
  ) {}

  @Post('facilities')
  createFacility(@Body() dto: CreateFacilityDto) {
    return this.provisioning.createFacility(dto);
  }

  @Post('facility-admins')
  createFacilityAdmin(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateOperatorDto,
  ) {
    return this.provisioning.createFacilityAdminSeat(
      request.user.sub,
      dto,
    );
  }

  @Post('operators')
  createOperator(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateOperatorDto,
  ) {
    return this.provisioning.createOperatorSeat(
      request.user.sub,
      dto,
    );
  }
  /**
   * Provision a resident directly into an active facility.
   *
   * Unlike public self-registration, this creates the institutional
   * membership before the resident can activate the account, eliminating
   * the window where an SOS can exist without its estate/facility context.
   */
  @Post('residents/bulk')
  createBulkResidents(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateBulkResidentsDto,
  ) {
    return this.provisioning.createBulkResidentInvites(
      request.user.sub,
      dto.residents,
    );
  }
  @Post('residents')
  createResident(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateResidentDto,
  ) {
    return this.provisioning.createResidentInvite(
      request.user.sub,
      dto,
    );
  }

  /**
   * Find one RESIDENT by an exact unique identifier.
   *
   * Not a search. email and phoneNumber are both unique and indexed, so
   * this returns one row or none - an admin is about to change somebody's
   * facility membership, and a list to disambiguate first is the wrong
   * shape for that.
   *
   * A match that is not a USER returns null, not an error. The question
   * is whether a resident exists; an operator is still no.
   */
  @Get('residents')
  findResident(@Query() query: FindResidentDto) {
    return this.provisioning.findResident(query);
  }

  /**
   * Everyone attached to a facility, partitioned by role.
   *
   * User.facilityId carries operators and residents in one column, so
   * this reads it once and splits rather than issuing two queries.
   */
  @Get('facilities/:facilityId/members')
  listFacilityMembers(@Param('facilityId') facilityId: string) {
    return this.provisioning.listFacilityMembers(facilityId);
  }

  @Get('residents/:userId/invitation')
  getResidentInvitation(@Param('userId') userId: string) {
    return this.provisioning.getResidentInvitation(userId);
  }

  @Post('residents/:userId/invitation/resend')
  resendResidentInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    return this.provisioning.resendResidentInvitation(request.user.sub, userId);
  }

  @Patch('residents/:userId/facility')
  assignResident(
    @Param('userId') userId: string,
    @Body() dto: AssignResidentFacilityDto,
  ) {
    return this.provisioning.assignResidentToFacility(
      userId,
      dto.facilityId,
    );
  }

  /**
   * Membership removal is FACILITY-SCOPED.
   *
   * The facility in the route is the admin's EXPECTED current membership.
   * If somebody reassigned the resident after the admin loaded their
   * screen, removal must fail rather than silently detach them from the
   * facility they were moved to.
   *
   * ASSIGNMENT DELIBERATELY STAYS LAST-WRITE-WINS. Assigning STATES where
   * a resident belongs, so the admin's intent is the target value.
   * Removing REVERSES a specific membership, so it is inherently about
   * the current one. The asymmetry is intentional, not an oversight.
   */
  @Delete('facilities/:facilityId/residents/:userId')
  removeResident(
    @Param('facilityId') facilityId: string,
    @Param('userId') userId: string,
  ) {
    return this.provisioning.removeResidentFromFacility(
      userId,
      facilityId,
    );
  }
}
