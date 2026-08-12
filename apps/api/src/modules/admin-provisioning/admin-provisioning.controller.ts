import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
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

  @Delete('residents/:userId/facility')
  removeResident(@Param('userId') userId: string) {
    return this.provisioning.removeResidentFromFacility(userId);
  }
}
