import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IncidentAccessGuard } from '../../shared/guards/incident-access.guard';
import { IncidentTimelineModule } from '../incident-timeline/incident-timeline.module';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';

@Module({
  imports: [PrismaModule, IncidentTimelineModule],
  controllers: [EvidenceController],
  providers: [EvidenceService, IncidentAccessGuard],
  exports: [EvidenceService],
})
export class EvidenceModule {}