import {
  Body,
  Headers,
  HttpCode,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminProvisioningService } from '../admin-provisioning/admin-provisioning.service';
import { randomUUID } from 'crypto';
import { EnrollmentService } from '../auth/enrollment.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateBulkFacilityAdminResidentsDto } from './dto/create-bulk-facility-admin-residents.dto';
import { CreateFacilityAdminResidentDto } from './dto/create-facility-admin-resident.dto';
import {
  FacilityAdminGuard,
  type FacilityAdminRequest,
} from './guards/facility-admin.guard';

@UseGuards(JwtAuthGuard, FacilityAdminGuard)
@Controller('facility-admin/facility/residents')
export class FacilityAdminResidentProvisioningController {
  constructor(private readonly provisioning: AdminProvisioningService, private readonly enrollment: EnrollmentService) {}

  @Get()
  async listResidents(@Req() request: FacilityAdminRequest) {
    const membership = await this.provisioning.listFacilityMembers(
      request.facilityAdminFacilityId,
    );

    return {
      facility: membership.facility,
      residents: membership.residents,
    };
  }

  @Get('enrollments')
  listEnrollments(@Req() request: FacilityAdminRequest) {
    return this.enrollment.list(request.facilityAdminFacilityId, request.user.sub);
  }

  @HttpCode(202)
  @Post()
  createResident(
    @Req() request: FacilityAdminRequest,
    @Body() dto: CreateFacilityAdminResidentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.enrollment.request(dto, key ?? randomUUID(), request.facilityAdminFacilityId, request.user.sub);
  }

  @HttpCode(202)
  @Post('bulk')
  createResidents(
    @Req() request: FacilityAdminRequest,
    @Body() dto: CreateBulkFacilityAdminResidentsDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.enrollment.bulk(dto.residents, key ?? randomUUID(), request.facilityAdminFacilityId, request.user.sub);
  }

  @Get(':userId/invitation')
  getInvitation(
    @Req() request: FacilityAdminRequest,
    @Param('userId') userId: string,
  ) {
    return this.provisioning.getResidentInvitation(
      userId,
      request.facilityAdminFacilityId,
    );
  }

  @Post(':userId/invitation/resend')
  resendInvitation(
    @Req() request: FacilityAdminRequest,
    @Param('userId') userId: string,
  ) {
    return this.provisioning.resendResidentInvitation(
      request.user.sub,
      userId,
      request.facilityAdminFacilityId,
    );
  }
}
