import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CreateIncidentRequestDto } from './dto/create-incident-request.dto';
import { IncidentOrchestratorService } from './incident-orchestrator.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard)
@Controller('incident-orchestrator')
export class IncidentOrchestratorController {
  constructor(
    private readonly incidentOrchestratorService: IncidentOrchestratorService,
  ) {}

  @Post('activate')
  activate(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateIncidentRequestDto,
  ) {
    return this.incidentOrchestratorService.createCoordinatedIncident(
      request.user.sub,
      dto,
    );
  }
}