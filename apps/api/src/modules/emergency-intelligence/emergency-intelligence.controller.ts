import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocationRequestDto } from './dto/location-request.dto';
import { EmergencyIntelligenceService } from './emergency-intelligence.service';

@UseGuards(JwtAuthGuard)
@Controller('emergency-intelligence')
export class EmergencyIntelligenceController {
  constructor(
    private readonly emergencyIntelligenceService: EmergencyIntelligenceService,
  ) {}

  @Post('location')
  buildLocationIntelligence(@Body() dto: LocationRequestDto) {
    return this.emergencyIntelligenceService.buildLocationIntelligence(dto);
  }
}