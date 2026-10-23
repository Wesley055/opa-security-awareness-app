import { Module } from '@nestjs/common';

import { IncidentAccessModule } from '../incident-access/incident-access.module';
import { EmergencyContactsModule } from '../emergency-contacts/emergency-contacts.module';
import { EmergencyDetectionModule } from '../emergency-detection/emergency-detection.module';
import { EmergencyIntelligenceModule } from '../emergency-intelligence/emergency-intelligence.module';
import { IncidentTimelineModule } from '../incident-timeline/incident-timeline.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { NotificationModule } from '../notifications/notification.module';
import { UsersModule } from '../users/users.module';
import { JourneyModule } from '../journey/journey.module';
import { IncidentOrchestratorController } from './incident-orchestrator.controller';
import { IncidentOrchestratorService } from './incident-orchestrator.service';

@Module({
  imports: [
    EmergencyContactsModule,
    EmergencyDetectionModule,
    EmergencyIntelligenceModule,
    IncidentsModule,
    NotificationModule,
    UsersModule,
    IncidentTimelineModule,
    IncidentAccessModule,
    JourneyModule,
  ],
  controllers: [IncidentOrchestratorController],
  providers: [IncidentOrchestratorService],
  exports: [IncidentOrchestratorService],
})
export class IncidentOrchestratorModule {}