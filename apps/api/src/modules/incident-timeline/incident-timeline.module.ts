import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IncidentAccessGuard } from '../../shared/guards/incident-access.guard';
import { IncidentTimelineController } from './incident-timeline.controller';
import { IncidentTimelineService } from './incident-timeline.service';

@Module({
  imports: [PrismaModule],
  controllers: [IncidentTimelineController],
  providers: [IncidentTimelineService, IncidentAccessGuard],
  exports: [IncidentTimelineService],
})
export class IncidentTimelineModule {}