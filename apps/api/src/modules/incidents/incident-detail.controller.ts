import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { IncidentAccessGuard } from '../../shared/guards/incident-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IncidentDetailService } from './incident-detail.service';

/**
 * One incident, read by its owner or by the facility watching it. 14A-7.
 *
 * SEPARATE FROM IncidentsController, DELIBERATELY. That controller carries
 * only JwtAuthGuard, because its routes are owner-scoped and the ownership
 * check lives inside the service. This route must admit an operator reading
 * somebody else's emergency, which is IncidentAccessGuard's question.
 *
 * A method-level @UseGuards on IncidentsController would have worked at
 * runtime and been INVISIBLE to controller-guard-attachment.spec.ts, which
 * reads CLASS metadata only. A guard that spec cannot see is a guard that
 * can be deleted without a test failing.
 *
 * ROUTE ORDER IS NOT A HAZARD HERE, but it is worth stating why. This
 * declares GET /incidents/:incidentId, while IncidentsController declares
 * GET /incidents and the timeline and evidence controllers declare
 * /incidents/:incidentId/timeline and /incidents/:incidentId/evidence. A
 * path parameter matches a SINGLE segment, so none of them overlap. Adding
 * a literal segment route here later - /incidents/summary, say - WOULD
 * collide, and would have to be declared before this method.
 *
 * READ-ONLY. There is no resolve, cancel or acknowledge on this controller
 * and there must not be one. incidents.service.ts: only the incident owner
 * may close an incident, because an operator asserting that somebody else's
 * emergency is over is a claim by an interested party. Acknowledgement is a
 * timeline event, not a status write.
 */
@UseGuards(JwtAuthGuard, IncidentAccessGuard)
@Controller('incidents')
export class IncidentDetailController {
  constructor(private readonly detailService: IncidentDetailService) {}

  @Get(':incidentId')
  getDetail(@Param('incidentId') incidentId: string) {
    return this.detailService.getDetail(incidentId);
  }
}