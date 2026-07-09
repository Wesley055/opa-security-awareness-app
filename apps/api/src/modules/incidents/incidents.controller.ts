import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
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
}