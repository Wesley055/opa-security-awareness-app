import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { type IncidentNotification, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from './notification.service';

/**
 * Background worker that will consume durable QUEUED IncidentNotification
 * rows (the outbox). Phase 2a: scaffolding only - it proves the scheduler
 * fires and the worker can reach the DB. It does NOT send anything yet; the
 * orchestrator's synchronous send remains the dispatch path until Phase 2c.
 */
@Injectable()
export class NotificationDispatchWorker {
  private readonly logger = new Logger(NotificationDispatchWorker.name);
  private running = false;
  private readonly batchSize = Number(process.env.DISPATCH_BATCH_SIZE ?? 25);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  @Interval(2000)
  async tick(): Promise<void> {
    // Prevent overlapping ticks if a batch runs longer than the interval.
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      let dispatched = 0;
      // Bounded batch: never loop until the queue is empty, or one tick could
      // monopolise the event loop under sustained load.
      for (let i = 0; i < this.batchSize; i += 1) {
        const claimed = await this.claimNextQueued();
        if (!claimed) {
          break;
        }
        await this.notificationService.dispatchNotification(claimed.id);
        dispatched += 1;
      }
      if (dispatched > 0) {
        this.logger.log(
          `Dispatch worker: dispatched ${dispatched} notification(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Notification dispatch tick failed.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Atomically claim the oldest QUEUED notification for dispatch.
   *
   * Uses an optimistic claim: updateMany WHERE id = ? AND status = QUEUED.
   * If exactly one row is updated, this caller owns it (it is now SENDING).
   * If zero rows update, another tick/worker claimed it first — return null.
   * This is the primitive that makes single- and multi-consumer dispatch
   * safe against double-send.
   *
   * NOTE (Phase 2b): defined and unit-tested but NOT yet called by tick().
   * Wiring claim + send + finalize together happens in Phase 2c, so we never
   * strand a row in SENDING with no delivery.
   *
   * The returned row reflects its PRE-claim state (stale status/attemptCount);
   * it is returned only as the identity of the successfully claimed row.
   */
  private async claimNextQueued(): Promise<IncidentNotification | null> {
    const candidate = await this.prisma.incidentNotification.findFirst({
      where: { status: NotificationStatus.QUEUED },
      orderBy: { queuedAt: 'asc' },
    });

    if (!candidate) {
      return null;
    }

    const claim = await this.prisma.incidentNotification.updateMany({
      where: {
        id: candidate.id,
        status: NotificationStatus.QUEUED,
      },
      data: {
        status: NotificationStatus.SENDING,
        attemptCount: { increment: 1 },
        failedAt: null,
        lastError: null,
      },
    });

    return claim.count === 1 ? candidate : null;
  }
}
