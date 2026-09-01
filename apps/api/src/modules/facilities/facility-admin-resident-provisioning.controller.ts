import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminProvisioningService } from '../admin-provisioning/admin-provisioning.service';
import type { CreateResidentDto } from '../admin-provisioning/dto/create-resident.dto';
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
  constructor(private readonly provisioning: AdminProvisioningService) {}

  @Post()
  createResident(
    @Req() request: FacilityAdminRequest,
    @Body() dto: CreateFacilityAdminResidentDto,
  ) {
    return this.provisioning.createResidentInvite(request.user.sub, {
      ...dto,
      facilityId: request.facilityAdminFacilityId,
    });
  }

  @Post('bulk')
  createResidents(
    @Req() request: FacilityAdminRequest,
    @Body() dto: CreateBulkFacilityAdminResidentsDto,
  ) {
    const residents: CreateResidentDto[] = dto.residents.map((resident) => ({
      ...resident,
      facilityId: request.facilityAdminFacilityId,
    }));

    return this.provisioning.createBulkResidentInvites(
      request.user.sub,
      residents,
    );
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
