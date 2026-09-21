import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationService } from "./notification.service";
import { DeliveryLedgerService } from "./delivery-ledger.service";

@Injectable()
export class NotificationDispatchWorker {
  private readonly logger = new Logger(NotificationDispatchWorker.name);
  private running = false;
  private readonly batchSize = Math.min(
    100,
    Math.max(1, Number(process.env.DISPATCH_BATCH_SIZE) || 25),
  );
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly ledger: DeliveryLedgerService = new DeliveryLedgerService(
      prisma,
    ),
  ) {}
  @Interval(2000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.ledger.recoverStale();
      const visited: string[] = [];
      for (let i = 0; i < this.batchSize; i++) {
        const row = await this.prisma.incidentNotification.findFirst({
          where: {
            status: "QUEUED",
            id: { notIn: visited },
            nextAttemptAt: { lte: new Date() },
            attemptCount: { lt: 5 },
          },
          orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
        });
        if (!row) break;
        visited.push(row.id);
        await this.notificationService.dispatchNotification(row.id);
      }
    } catch {
      this.logger.error(
        "Delivery worker failed; durable state retained for recovery.",
      );
    } finally {
      this.running = false;
    }
  }
}
