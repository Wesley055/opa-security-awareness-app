import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IncidentAccessModule } from '../incident-access/incident-access.module';
import { IncidentTimelineModule } from '../incident-timeline/incident-timeline.module';
import { JourneyModule } from '../journey/journey.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { IncidentAccessGuard } from '../../shared/guards/incident-access.guard';
import { IncidentDetailController } from './incident-detail.controller';
import { IncidentDetailService } from './incident-detail.service';
import { IncidentTrackingService } from './incident-tracking.service';

// IncidentAccessModule has no imports of its own, IncidentTimelineModule
// imports only PrismaModule, and JourneyModule imports nothing at all - so
// none creates a cycle with this module.
@Module({
  imports: [
    PrismaModule,
    IncidentAccessModule,
    IncidentTimelineModule,
    JourneyModule,
  ],
  controllers: [IncidentsController, IncidentDetailController],
  providers: [
    IncidentsService,
    IncidentDetailService,
    IncidentTrackingService,
    IncidentAccessGuard,
  ],
  exports: [IncidentsService],
})
export class IncidentsModule {}