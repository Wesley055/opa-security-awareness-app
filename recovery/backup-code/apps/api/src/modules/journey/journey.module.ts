import { NotificationModule } from '../notifications/notification.module';
import { ProtectedIdentityModule } from '../protected-identity/protected-identity.module';
import { SafeWalkNotificationWorker } from './safewalk-notification.worker';
import { Module } from '@nestjs/common';
import { JourneySessionService } from './journey-session.service';
import { JourneyIngestionService } from './journey-ingestion.service';
import { JourneyController } from './journey.controller';
import { SafeWalkService } from './safewalk.service';
import { SafeWalkGuardianService } from './safewalk-guardian.service';
import { SafeWalkGuardianController } from './safewalk-guardian.controller';
import { SafeWalkEscalationService } from './safewalk-escalation.service';
import { EmergencyIntelligenceModule } from '../emergency-intelligence/emergency-intelligence.module';

// JourneySessionService still receives its transaction client explicitly.
// EmergencyIntelligenceModule supplies the snapshot service used by
// JourneyIngestionService after a successful committed ingestion.
@Module({
  imports: [EmergencyIntelligenceModule, NotificationModule, ProtectedIdentityModule],
  controllers: [JourneyController, SafeWalkGuardianController],
  providers: [JourneySessionService, JourneyIngestionService, SafeWalkService, SafeWalkGuardianService, SafeWalkEscalationService, SafeWalkNotificationWorker],
  exports: [JourneySessionService],
})
export class JourneyModule {}
