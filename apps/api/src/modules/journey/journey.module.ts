import { Module } from '@nestjs/common';
import { JourneySessionService } from './journey-session.service';
import { JourneyIngestionService } from './journey-ingestion.service';
import { JourneyController } from './journey.controller';
import { EmergencyIntelligenceModule } from '../emergency-intelligence/emergency-intelligence.module';

// JourneySessionService still receives its transaction client explicitly.
// EmergencyIntelligenceModule supplies the snapshot service used by
// JourneyIngestionService after a successful committed ingestion.
@Module({
  imports: [EmergencyIntelligenceModule],
  controllers: [JourneyController],
  providers: [JourneySessionService, JourneyIngestionService],
  exports: [JourneySessionService],
})
export class JourneyModule {}
