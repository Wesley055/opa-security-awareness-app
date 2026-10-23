import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DeliveryLedgerService } from "./delivery-ledger.service";

/** Receipt reconciliation must not wait behind slow outbound provider calls. */
@Injectable()
export class DeliveryReceiptWorker {
  private running = false;
  private readonly logger = new Logger(DeliveryReceiptWorker.name);
  constructor(private readonly ledger: DeliveryLedgerService) {}
  @Interval(2000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.ledger.reconcileReceipts();
    } catch {
      this.logger.error(
        "Receipt reconciliation failed; durable inbox retained.",
      );
    } finally {
      this.running = false;
    }
  }
}
