import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DutyService } from "./duty.service";

@Injectable()
export class DutyWorker {
  private readonly logger = new Logger(DutyWorker.name);
  private running = false;
  constructor(private readonly duty: DutyService) {}

  @Interval(5 * 60_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.duty.sweep();
      if (n) this.logger.log(`Duty sweep: ${n} shift(s) closed by OPA; operator reports still required`);
    } catch (error) {
      this.logger.error(`Duty sweep failed: ${error instanceof Error ? error.name : "unknown"}`);
    } finally {
      this.running = false;
    }
  }
}
