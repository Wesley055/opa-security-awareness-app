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
import { SafeWalkContactsService } from './safewalk-contacts.service';
import { SafeWalkPlacesService } from './safewalk-places.service';
import { SafeWalkNigeriaController } from './safewalk-nigeria.controller';
import { SafeWalkContactNoticeWorker } from './safewalk-contact-notice.worker';
import { EmergencyIntelligenceModule } from '../emergency-intelligence/emergency-intelligence.module';

// JourneySessionService still receives its transaction client explicitly.
// EmergencyIntelligenceModule supplies the snapshot service used by
// JourneyIngestionService after a successful committed ingestion.
@Module({
  imports: [EmergencyIntelligenceModule, NotificationModule, ProtectedIdentityModule],
  controllers: [JourneyController, SafeWalkGuardianController, SafeWalkNigeriaController],
  providers: [JourneySessionService, JourneyIngestionService, SafeWalkService, SafeWalkGuardianService, SafeWalkEscalationService, SafeWalkNotificationWorker, SafeWalkContactsService, SafeWalkPlacesService, SafeWalkContactNoticeWorker],
  exports: [JourneySessionService],
})
export class JourneyModule {}
