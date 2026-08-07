import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CloseIncidentDto } from './dto/close-incident.dto';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { IncidentsService } from './incidents.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateIncidentDto,
  ) {
    return this.incidentsService.create(request.user.sub, dto);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.incidentsService.listForUser(request.user.sub);
  }

  /**
   * The subject reports that the emergency is over. Owner only - the service
   * enforces it, and a non-owner receives the same 404 as a stranger.
   */
  @Patch(':incidentId/resolve')
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param('incidentId') incidentId: string,
    @Body() dto: CloseIncidentDto,
  ) {
    return this.incidentsService.resolve(incidentId, request.user.sub, dto);
  }

  /** The subject reports that the activation was accidental. Owner only. */
  @Patch(':incidentId/cancel')
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('incidentId') incidentId: string,
    @Body() dto: CloseIncidentDto,
  ) {
    return this.incidentsService.cancel(incidentId, request.user.sub, dto);
  }
}