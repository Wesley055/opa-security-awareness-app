import { Module } from '@nestjs/common';
import { JourneySessionService } from './journey-session.service';
import { JourneyIngestionService } from './journey-ingestion.service';
import { JourneyController } from './journey.controller';
import { EmergencyIntelligenceModule } from '../emergency-intelligence/emergency-intelligence.module';

// No imports: JourneySessionService injects nothing. Every method takes an
// explicit Prisma.TransactionClient from its caller, because the advisory
// locks it relies on are transaction-scoped.
@Module({
  controllers: [JourneyController],
  providers: [JourneySessionService, JourneyIngestionService],
  exports: [JourneySessionService],
})
export class JourneyModule {}
