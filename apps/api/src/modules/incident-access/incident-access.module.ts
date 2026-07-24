import { Module } from '@nestjs/common';
import { IncidentAccessTokenService } from './incident-access-token.service';

/**
 * Capability tokens for incident tracking links.
 *
 * Exported so the orchestrator can issue a token inside the same transaction
 * that creates an incident, and so the tracking controller can resolve one.
 */
@Module({
  providers: [IncidentAccessTokenService],
  exports: [IncidentAccessTokenService],
})
export class IncidentAccessModule {}
