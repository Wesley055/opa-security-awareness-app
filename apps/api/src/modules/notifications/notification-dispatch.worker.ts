import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Background worker that will consume durable QUEUED IncidentNotification
 * rows (the outbox). Phase 2a: scaffolding only — it proves the scheduler
 * fires and the worker can reach the DB. It does NOT send anything yet; the
 * orchestrator's synchronous send remains the dispatch path until Phase 2c.
 */
@Injectable()
export class NotificationDispatchWorker {
  private readonly logger = new Logger(NotificationDispatchWorker.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Interval(2000)
  async tick(): Promise<void> {
    // Prevent overlapping ticks if a future (Phase 2c) tick runs longer
    // than the 2s interval.
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const queued = await this.prisma.incidentNotification.count({
        where: { status: NotificationStatus.QUEUED },
      });
      if (queued > 0) {
        this.logger.debug(
          `Dispatch worker: ${queued} QUEUED notification(s) pending`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to inspect notification dispatch queue.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
