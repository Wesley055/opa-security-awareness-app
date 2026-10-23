import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TriggerRequestDto } from './dto/trigger-request.dto';
import { EmergencyDetectionService } from './emergency-detection.service';

@UseGuards(JwtAuthGuard)
@Controller('emergency-detection')
export class EmergencyDetectionController {
  constructor(
    private readonly emergencyDetectionService: EmergencyDetectionService,
  ) {}

  @Post('evaluate')
  evaluate(@Body() dto: TriggerRequestDto) {
    return this.emergencyDetectionService.evaluate(dto);
  }

  @Get('languages')
  getSupportedLanguages() {
    return this.emergencyDetectionService.getSupportedLanguages();
  }

  @Get('default-profile')
  getDefaultProfile() {
    return this.emergencyDetectionService.getDefaultProfile();
  }
}