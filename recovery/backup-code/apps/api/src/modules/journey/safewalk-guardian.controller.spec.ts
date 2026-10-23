import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SafeWalkGuardianController } from "./safewalk-guardian.controller";
import { SafeWalkEscalationService } from "./safewalk-escalation.service";

describe("SafeWalk exposure and scheduler gates", () => {
  it("attaches authentication to every guardian/inbox route", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SafeWalkGuardianController),
    ).toEqual([JwtAuthGuard]);
  });
  it("does not run scheduled work unless explicitly enabled", async () => {
    const before = process.env.SAFEWALK_ESCALATION_ENABLED;
    delete process.env.SAFEWALK_ESCALATION_ENABLED;
    try {
      const worker = new SafeWalkEscalationService({} as never, {} as never);
      const run = jest.spyOn(worker, "runBatch").mockResolvedValue(0);
      await worker.tick();
      expect(run).not.toHaveBeenCalled();
    } finally {
      if (before === undefined) delete process.env.SAFEWALK_ESCALATION_ENABLED;
      else process.env.SAFEWALK_ESCALATION_ENABLED = before;
    }
  });
  it("retries durable work on the next enabled tick after failure", async () => {
    const before = process.env.SAFEWALK_ESCALATION_ENABLED;
    process.env.SAFEWALK_ESCALATION_ENABLED = "true";
    try {
      const worker = new SafeWalkEscalationService({} as never, {} as never);
      const run = jest
        .spyOn(worker, "runBatch")
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(1);
      await worker.tick();
      await worker.tick();
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      if (before === undefined) delete process.env.SAFEWALK_ESCALATION_ENABLED;
      else process.env.SAFEWALK_ESCALATION_ENABLED = before;
    }
  });
});
