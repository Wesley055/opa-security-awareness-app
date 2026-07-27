import { Module } from '@nestjs/common';
import { JourneySessionService } from './journey-session.service';

// No imports: JourneySessionService injects nothing. Every method takes an
// explicit Prisma.TransactionClient from its caller, because the advisory
// locks it relies on are transaction-scoped.
@Module({
  providers: [JourneySessionService],
  exports: [JourneySessionService],
})
export class JourneyModule {}
