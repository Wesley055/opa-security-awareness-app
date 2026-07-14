import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IncidentTimelineController } from './incident-timeline.controller';
import { IncidentTimelineService } from './incident-timeline.service';
import { IncidentAccessGuard } from './guards/incident-access.guard';

@Module({
  imports: [PrismaModule],
  controllers: [IncidentTimelineController],
  providers: [IncidentTimelineService, IncidentAccessGuard],
  exports: [IncidentTimelineService],
})
export class IncidentTimelineModule {}