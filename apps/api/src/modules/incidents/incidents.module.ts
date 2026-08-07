import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IncidentAccessModule } from '../incident-access/incident-access.module';
import { IncidentTimelineModule } from '../incident-timeline/incident-timeline.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

// IncidentAccessModule has no imports of its own and IncidentTimelineModule
// imports only PrismaModule, so neither creates a cycle with this module.
@Module({
  imports: [PrismaModule, IncidentAccessModule, IncidentTimelineModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}