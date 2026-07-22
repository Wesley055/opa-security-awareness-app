import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { type IncidentNotification, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
