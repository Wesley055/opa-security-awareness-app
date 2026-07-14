import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IncidentAccessGuard } from '../../shared/guards/incident-access.guard';
import { IncidentTimelineService } from './incident-timeline.service';

@UseGuards(JwtAuthGuard, IncidentAccessGuard)
@Controller('incidents/:incidentId/timeline')
export class IncidentTimelineController {
  constructor(private readonly timelineService: IncidentTimelineService) {}

  @Get()
  getTimeline(@Param('incidentId') incidentId: string) {
    return this.timelineService.getTimeline(incidentId);
  }

  @Get('verify')
  verifyChain(@Param('incidentId') incidentId: string) {
    return this.timelineService.verifyChain(incidentId);
  }
}