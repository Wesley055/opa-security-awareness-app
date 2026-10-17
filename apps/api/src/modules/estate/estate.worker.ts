import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { EstateService } from "./estate.service";

@Injectable()
export class EstateWorker {
  private readonly logger = new Logger(EstateWorker.name);
  private running = false;
  constructor(private readonly estate: EstateService) {}

  @Interval(60_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const { overstays, expired } = await this.estate.sweep();
      if (overstays || expired) this.logger.log(`EstateFlow sweep: ${overstays} departure(s) unconfirmed, ${expired} pass(es) expired`);
    } catch (error) {
      this.logger.error(`EstateFlow sweep failed: ${error instanceof Error ? error.name : "unknown"}`);
    } finally {
      this.running = false;
    }
  }
}
