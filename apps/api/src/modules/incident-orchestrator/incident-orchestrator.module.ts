import { Module } from '@nestjs/common';
import { EmergencyContactsModule } from '../emergency-contacts/emergency-contacts.module';
import { EmergencyDetectionModule } from '../emergency-detection/emergency-detection.module';
import { EmergencyIntelligenceModule } from '../emergency-intelligence/emergency-intelligence.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { NotificationModule } from '../notifications/notification.module';
import { IncidentOrchestratorController } from './incident-orchestrator.controller';
import { IncidentOrchestratorService } from './incident-orchestrator.service';

@Module({
  imports: [
    EmergencyContactsModule,
    EmergencyDetectionModule,
    EmergencyIntelligenceModule,
    IncidentsModule,
    NotificationModule,
  ],
  controllers: [IncidentOrchestratorController],
  providers: [IncidentOrchestratorService],
  exports: [IncidentOrchestratorService],
})
export class IncidentOrchestratorModule {}