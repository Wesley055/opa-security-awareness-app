import { ProtectedSnapshotsService } from "../../src/modules/protected-identity/protected-snapshots.service";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotFoundException } from "@nestjs/common";
import { prismaTest } from "./prisma-test-client";
import { createUser } from "./fixtures";
import { SafeWalkGuardianService } from "../../src/modules/journey/safewalk-guardian.service";
import { SafeWalkEscalationService } from "../../src/modules/journey/safewalk-escalation.service";
import { SafeWalkService } from "../../src/modules/journey/safewalk.service";
import { JourneySessionService } from "../../src/modules/journey/journey-session.service";
import { JourneyIngestionService } from "../../src/modules/journey/journey-ingestion.service";
import {
  dbTime,
  deadlines,
  OWNER_CHECK_MESSAGE,
} from "../../src/modules/journey/safewalk-policy";

const guardians = new SafeWalkGuardianService(prismaTest as never);
const worker = new SafeWalkEscalationService(prismaTest as never, new ProtectedSnapshotsService(prismaTest as never, {} as never));
const journeys = new JourneySessionService();
const ownerApi = new SafeWalkService(prismaTest as never, journeys);

async function setup(minutesPastEta = 5) {
  const owner = await createUser();
  const guardian = await createUser();
  const now = await dbTime(prismaTest);
  const eta = new Date(now.getTime() - minutesPastEta * 60_000 - 1000);
  const session = await prismaTest.journeySession.create({
    data: {
      userId: owner.id,
      purpose: "SAFEWALK",
      expectedArrivalAt: eta,
      destinationLabel: "Private home",
      destinationLatitude: 6.5,
      destinationLongitude: 3.4,
      safeWalkEscalation: { create: deadlines(eta) },
    },
  });
  const { code } = await guardians.issueCode(guardian.id);
  const grant = await guardians.authorize(owner.id, session.id, code);
  return { owner, guardian, session, grant, code };
}

/// Seed an already-available +5 prompt so a +8 transition is testable without wall-clock sleeps.
async function readyForGuardian(sessionId: string) {
  const schedule = await prismaTest.safeWalkEscalation.findUniqueOrThrow({
    where: { sessionId },
  });
  const session = await prismaTest.journeySession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  await prismaTest.safeWalkEscalation.update({
    where: { sessionId },
    data: {
      state: "CHECK_REQUIRED",
      checkRequiredAt: schedule.checkDueAt,
      responseDueAt: schedule.guardianDueAt,
    },
  });
  await prismaTest.safeWalkNotice.create({
    data: {
      sessionId,
      recipientUserId: session.userId,
      kind: "OWNER_CHECK",
      message: OWNER_CHECK_MESSAGE,
      reasonCode: "EXPECTED_ARRIVAL_NOT_CONFIRMED",
      availableAt: schedule.checkDueAt,
    },
  });
}

describe("SafeWalk guardian authorization and durable escalation", () => {
  it("creates deadlines atomically through the existing start API", async () => {
    const owner = await createUser();
    const eta = new Date(Date.now() + 60_000);
    const api = new JourneyIngestionService(
      prismaTest as never,
      journeys,
      {} as never,
    );
    const result = await api.startSession(owner.id, {
      purpose: "SAFEWALK",
      expectedArrivalAt: eta.toISOString(),
      destinationLabel: "Home",
      destinationLatitude: 6.5,
      destinationLongitude: 3.4,
    });
    expect(
      await prismaTest.safeWalkEscalation.findUnique({
        where: { sessionId: result.sessionId },
      }),
    ).toEqual(
      expect.objectContaining({ state: "SCHEDULED", ...deadlines(eta) }),
    );
  });

  it("stores hashed pairing credentials and makes owner selection idempotent", async () => {
    const { owner, guardian, session, grant, code } = await setup();
    expect(await guardians.authorize(owner.id, session.id, code)).toEqual(
      grant,
    );
    expect(await prismaTest.safeWalkGuardianGrant.count()).toBe(1);
    const stored = await prismaTest.safeWalkGuardianCode.findFirstOrThrow({
      where: { userId: guardian.id },
    });
    expect(stored.codeHash).not.toBe(code);
    expect(stored.consumedForSessionId).toBe(session.id);
    expect(
      await prismaTest.safeWalkAudit.count({
        where: { kind: "GUARDIAN_AUTHORIZED" },
      }),
    ).toBe(1);
  });

  it("does not allow a foreign owner to select a guardian or read owner status", async () => {
    const { session } = await setup();
    const stranger = await createUser();
    const { code } = await guardians.issueCode(stranger.id);
    await expect(
      guardians.authorize(stranger.id, session.id, code),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      ownerApi.getStatus(stranger.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      guardians.sharedStatus(stranger.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns only the status/ETA fields explicitly shared and audits the read", async () => {
    const { guardian, session } = await setup();
    const result = await guardians.sharedStatus(guardian.id, session.id);
    expect(Object.keys(result).sort()).toEqual([
      "arrivalConfirmedAt",
      "expectedArrivalAt",
      "id",
      "safetyConfirmedAt",
      "scope",
      "status",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /Private home|email|phoneNumber|latitude|longitude|fixes|facility/,
    );
    await expect(
      guardians.sharedStatus(guardian.id, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await prismaTest.safeWalkAudit.count({
        where: { kind: "GUARDIAN_READ", actorUserId: guardian.id },
      }),
    ).toBe(1);
  });

  it("persists the +5 requirement and exactly one owner prompt across concurrent workers", async () => {
    const { owner, session } = await setup();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        new SafeWalkEscalationService(prismaTest as never, new ProtectedSnapshotsService(prismaTest as never, {} as never)).processSession(
          session.id,
        ),
      ),
    );
    const state = await prismaTest.safeWalkEscalation.findUniqueOrThrow({
      where: { sessionId: session.id },
    });
    expect(state.state).toBe("CHECK_REQUIRED");
    expect(
      state.responseDueAt!.getTime() - state.checkRequiredAt!.getTime(),
    ).toBeGreaterThanOrEqual(180_000);
    expect(
      await prismaTest.safeWalkNotice.count({
        where: { sessionId: session.id, kind: "OWNER_CHECK" },
      }),
    ).toBe(1);
    expect(
      await prismaTest.safeWalkAudit.count({
        where: { sessionId: session.id, kind: "CHECK_REQUIRED" },
      }),
    ).toBe(1);
    const inbox = await guardians.inbox(owner.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.message).toContain("confirm your safety");
  });

  it("does not transition before +5", async () => {
    const { session } = await setup(4);
    await worker.processSession(session.id);
    expect(await prismaTest.safeWalkNotice.count()).toBe(0);
    expect(
      (
        await prismaTest.safeWalkEscalation.findUniqueOrThrow({
          where: { sessionId: session.id },
        })
      ).state,
    ).toBe("SCHEDULED");
  });

  it("does not notify guardians before the response deadline", async () => {
    const { session } = await setup();
    await worker.processSession(session.id);
    await worker.processSession(session.id);
    expect(
      await prismaTest.safeWalkNotice.count({
        where: { kind: "GUARDIAN_OVERDUE" },
      }),
    ).toBe(0);
  });

  it("confirmation after the check cancels pending escalation atomically", async () => {
    const { owner, session } = await setup(9);
    await readyForGuardian(session.id);
    await ownerApi.confirm(owner.id, session.id, "SAFETY");
    await worker.processSession(session.id);
    expect(
      (
        await prismaTest.safeWalkEscalation.findUniqueOrThrow({
          where: { sessionId: session.id },
        })
      ).state,
    ).toBe("SATISFIED");
    expect(
      await prismaTest.safeWalkNotice.count({
        where: { kind: "GUARDIAN_OVERDUE" },
      }),
    ).toBe(0);
    expect(await guardians.inbox(owner.id)).toEqual([]);
  });

  it("an early safety confirmation prevents escalation for this ETA cycle", async () => {
    const { owner, session } = await setup(4);
    await ownerApi.confirm(owner.id, session.id, "SAFETY");
    await worker.processSession(session.id);
    expect(await prismaTest.safeWalkNotice.count()).toBe(0);
    expect(
      (
        await prismaTest.safeWalkEscalation.findUniqueOrThrow({
          where: { sessionId: session.id },
        })
      ).state,
    ).toBe("SATISFIED");
  });

  it("creates only selected-guardian overdue notices once across concurrent +8 workers and restarts", async () => {
    const { guardian, session, grant } = await setup(9);
    const unselected = await createUser();
    await readyForGuardian(session.id);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        new SafeWalkEscalationService(prismaTest as never, new ProtectedSnapshotsService(prismaTest as never, {} as never)).processSession(
          session.id,
        ),
      ),
    );
    await worker.runBatch();
    const notices = await prismaTest.safeWalkNotice.findMany({
      where: { kind: "GUARDIAN_OVERDUE" },
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual(
      expect.objectContaining({
        recipientUserId: guardian.id,
        grantId: grant.grantId,
      }),
    );
    expect(notices[0]?.message).toContain("non-emergency");
    expect(await guardians.inbox(unselected.id)).toEqual([]);
    expect(await guardians.inbox(guardian.id)).toHaveLength(1);
    expect(
      await prismaTest.safeWalkAudit.count({
        where: { kind: "GUARDIAN_NOTICE_AVAILABLE" },
      }),
    ).toBe(1);
  });

  it("overdue creates no incident, operator grant, or private analytics", async () => {
    const { owner, session } = await setup(9);
    const operator = await createUser();
    await prismaTest.user.update({
      where: { id: operator.id },
      data: { role: "FACILITY_OPERATOR" },
    });
    await readyForGuardian(session.id);
    await worker.processSession(session.id);
    expect(await prismaTest.incident.count()).toBe(0);
    expect(await prismaTest.emergencyIntelligenceSnapshot.count()).toBe(0);
    await expect(
      guardians.sharedStatus(operator.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      ownerApi.getStatus(operator.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(guardians.issueCode(operator.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      (
        await prismaTest.journeySession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).userId,
    ).toBe(owner.id);
  });

  it("completion before +5 closes the schedule without a prompt", async () => {
    const { owner, session } = await setup(4);
    await ownerApi.confirm(owner.id, session.id, "ARRIVAL");
    await worker.processSession(session.id);
    expect(await prismaTest.safeWalkNotice.count()).toBe(0);
    expect(
      (
        await prismaTest.journeySession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).status,
    ).toBe("ENDED");
  });

  it("generic journey ending cancels a pending check", async () => {
    const { owner, session } = await setup();
    await worker.processSession(session.id);
    await prismaTest.$transaction((tx) =>
      journeys.endSession(tx, owner.id, session.id),
    );
    expect(await guardians.inbox(owner.id)).toEqual([]);
    expect(
      (
        await prismaTest.safeWalkEscalation.findUniqueOrThrow({
          where: { sessionId: session.id },
        })
      ).state,
    ).toBe("CLOSED");
  });

  it("revocation blocks future reads and overdue notices", async () => {
    const { owner, guardian, session, grant } = await setup(9);
    await readyForGuardian(session.id);
    const revoked = await guardians.revoke(owner.id, session.id, grant.grantId);
    expect(await guardians.revoke(owner.id, session.id, grant.grantId)).toEqual(
      revoked,
    );
    await worker.processSession(session.id);
    await expect(
      guardians.sharedStatus(guardian.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await prismaTest.safeWalkNotice.count({
        where: { kind: "GUARDIAN_OVERDUE" },
      }),
    ).toBe(0);
  });

  it("rechecks facility membership for reads and dispatch, without treating facility as tenant", async () => {
    const { guardian, session } = await setup(9);
    const facility = await prismaTest.facility.create({
      data: { name: "Separate facility", type: "OTHER" },
    });
    await prismaTest.user.update({
      where: { id: guardian.id },
      data: { facilityId: facility.id },
    });
    await expect(
      guardians.sharedStatus(guardian.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await readyForGuardian(session.id);
    await worker.processSession(session.id);
    expect(await guardians.inbox(guardian.id)).toEqual([]);
    expect(
      await prismaTest.safeWalkNotice.count({
        where: { kind: "GUARDIAN_OVERDUE" },
      }),
    ).toBe(0);
  });

  it("rejects cross-facility guardian selection and accepts same-facility selection", async () => {
    const { owner, session } = await setup();
    const another = await createUser();
    const facility = await prismaTest.facility.create({
      data: { name: "Boundary", type: "OTHER" },
    });
    await prismaTest.user.update({
      where: { id: another.id },
      data: { facilityId: facility.id },
    });
    const { code } = await guardians.issueCode(another.id);
    await expect(
      guardians.authorize(owner.id, session.id, code),
    ).rejects.toBeInstanceOf(NotFoundException);
    await prismaTest.user.update({
      where: { id: owner.id },
      data: { facilityId: facility.id },
    });
    expect(
      await guardians.authorize(owner.id, session.id, code),
    ).toHaveProperty("grantId");
  });

  it("acknowledges only the recipient notice and preserves the first acknowledgement", async () => {
    const { owner, guardian, session } = await setup();
    await worker.processSession(session.id);
    const [notice] = await guardians.inbox(owner.id);
    if (!notice) throw new Error("Expected owner notice");
    await expect(
      guardians.acknowledge(guardian.id, notice.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    const ack = await guardians.acknowledge(owner.id, notice.id);
    expect(await guardians.acknowledge(owner.id, notice.id)).toEqual(ack);
    expect(
      (
        await prismaTest.safeWalkEscalation.findUniqueOrThrow({
          where: { sessionId: session.id },
        })
      ).state,
    ).toBe("CHECK_REQUIRED");
  });

  it("cancels already-available guardian notices after safety confirmation without deleting provenance", async () => {
    const { owner, guardian, session } = await setup(9);
    await readyForGuardian(session.id);
    await worker.processSession(session.id);
    await ownerApi.confirm(owner.id, session.id, "SAFETY");
    expect(await guardians.inbox(guardian.id)).toEqual([]);
    const record = await prismaTest.safeWalkNotice.findFirstOrThrow({
      where: { kind: "GUARDIAN_OVERDUE" },
    });
    expect(record.cancelledAt).not.toBeNull();
    expect(
      await prismaTest.safeWalkAudit.count({
        where: { kind: "GUARDIAN_NOTICE_AVAILABLE" },
      }),
    ).toBe(1);
  });

  it("serializes confirmation and due workers without duplicate or surviving actionable notifications", async () => {
    const { owner, guardian, session } = await setup(9);
    await readyForGuardian(session.id);
    await Promise.all([
      worker.processSession(session.id),
      ownerApi.confirm(owner.id, session.id, "SAFETY"),
      worker.processSession(session.id),
    ]);
    expect(
      await prismaTest.safeWalkNotice.count({
        where: { kind: "GUARDIAN_OVERDUE" },
      }),
    ).toBeLessThanOrEqual(1);
    expect(await guardians.inbox(guardian.id)).toEqual([]);
    expect(await prismaTest.incident.count()).toBe(0);
  });

  it("rolls back the state transition if a notice cannot be persisted, then retries successfully", async () => {
    const { session } = await setup();
    await prismaTest.$executeRawUnsafe(
      `ALTER TABLE "SafeWalkNotice" ADD CONSTRAINT validation_reject_notice CHECK (false) NOT VALID`,
    );
    try {
      await expect(worker.processSession(session.id)).rejects.toThrow();
      expect(
        (
          await prismaTest.safeWalkEscalation.findUniqueOrThrow({
            where: { sessionId: session.id },
          })
        ).state,
      ).toBe("SCHEDULED");
    } finally {
      await prismaTest.$executeRawUnsafe(
        `ALTER TABLE "SafeWalkNotice" DROP CONSTRAINT validation_reject_notice`,
      );
    }
    await worker.processSession(session.id);
    expect(await prismaTest.safeWalkNotice.count()).toBe(1);
  });

  it("rejects expired pairing codes without disclosing another account", async () => {
    const { owner, session } = await setup();
    const another = await createUser();
    const { code } = await guardians.issueCode(another.id);
    await prismaTest.safeWalkGuardianCode.updateMany({
      where: { userId: another.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      guardians.authorize(owner.id, session.id, code),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await prismaTest.safeWalkGuardianGrant.count()).toBe(1);
  });

  it("consumes a pairing code only once when two owners race to authorize it", async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const guardian = await createUser();
    const sessionA = await prismaTest.journeySession.create({
      data: { userId: ownerA.id, purpose: "SAFEWALK" },
    });
    const sessionB = await prismaTest.journeySession.create({
      data: { userId: ownerB.id, purpose: "SAFEWALK" },
    });
    const { code } = await guardians.issueCode(guardian.id);
    const results = await Promise.allSettled([
      guardians.authorize(ownerA.id, sessionA.id, code),
      guardians.authorize(ownerB.id, sessionB.id, code),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await prismaTest.safeWalkGuardianGrant.count()).toBe(1);
  });

  it("revocation racing escalation leaves no actionable guardian message or read access", async () => {
    const { owner, guardian, session, grant } = await setup(9);
    await readyForGuardian(session.id);
    await Promise.all([
      worker.processSession(session.id),
      guardians.revoke(owner.id, session.id, grant.grantId),
    ]);
    expect(await guardians.inbox(guardian.id)).toEqual([]);
    await expect(
      guardians.sharedStatus(guardian.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await prismaTest.safeWalkNotice.count({
        where: { kind: "GUARDIAN_OVERDUE" },
      }),
    ).toBeLessThanOrEqual(1);
  });

  it.each(["suspended", "operator"] as const)(
    "rechecks guardian eligibility after authorization: %s",
    async (change) => {
      const { guardian, session } = await setup(9);
      await prismaTest.user.update({
        where: { id: guardian.id },
        data:
          change === "suspended"
            ? { isActive: false }
            : { role: "FACILITY_OPERATOR" },
      });
      await readyForGuardian(session.id);
      await worker.processSession(session.id);
      await expect(
        guardians.sharedStatus(guardian.id, session.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        await prismaTest.safeWalkNotice.count({
          where: { kind: "GUARDIAN_OVERDUE" },
        }),
      ).toBe(0);
    },
  );

  it("redacted journeys cannot be read or escalated to guardians", async () => {
    const { guardian, session } = await setup(9);
    await readyForGuardian(session.id);
    await prismaTest.journeySession.update({
      where: { id: session.id },
      data: { redactedAt: new Date() },
    });
    await worker.processSession(session.id);
    await expect(
      guardians.sharedStatus(guardian.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await guardians.inbox(guardian.id)).toEqual([]);
    expect(
      await prismaTest.safeWalkNotice.count({
        where: { kind: "GUARDIAN_OVERDUE" },
      }),
    ).toBe(0);
  });

  it("backfills legacy journeys without manufacturing historical notifications", async () => {
    const owner = await createUser();
    const eta = new Date(Date.now() - 9 * 60_000);
    const legacy = await prismaTest.journeySession.create({
      data: { userId: owner.id, purpose: "SAFEWALK", expectedArrivalAt: eta },
    });
    const sql = readFileSync(
      join(
        __dirname,
        "../../prisma/migrations/20260909020000_safewalk_guardians_escalation/migration.sql",
      ),
      "utf8",
    );
    await prismaTest.$executeRawUnsafe(sql.slice(sql.indexOf("-- Backfill")));
    expect(
      (
        await prismaTest.safeWalkEscalation.findUniqueOrThrow({
          where: { sessionId: legacy.id },
        })
      ).state,
    ).toBe("SCHEDULED");
    expect(await prismaTest.safeWalkNotice.count()).toBe(0);
    await worker.runBatch();
    const state = await prismaTest.safeWalkEscalation.findUniqueOrThrow({
      where: { sessionId: legacy.id },
    });
    expect(state.state).toBe("CHECK_REQUIRED");
    expect(
      state.responseDueAt!.getTime() - state.checkRequiredAt!.getTime(),
    ).toBeGreaterThanOrEqual(180_000);
  });

  it("lets the owner recover selected grant identifiers without listing family accounts", async () => {
    const { owner, session, grant } = await setup();
    const status = await ownerApi.getStatus(owner.id, session.id);
    expect(status.guardianGrants).toEqual([
      expect.objectContaining({ id: grant.grantId }),
    ]);
    expect(Object.keys(status.guardianGrants[0]!).sort()).toEqual([
      "grantedAt",
      "id",
      "policyVersion",
      "revokedAt",
    ]);
  });

  it("does not silently revive an old grant under a different facility snapshot", async () => {
    const { owner, guardian, session } = await setup();
    const facility = await prismaTest.facility.create({
      data: { name: "Changed boundary", type: "OTHER" },
    });
    await prismaTest.user.updateMany({
      where: { id: { in: [owner.id, guardian.id] } },
      data: { facilityId: facility.id },
    });
    const { code } = await guardians.issueCode(guardian.id);
    await expect(
      guardians.authorize(owner.id, session.id, code),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      guardians.sharedStatus(guardian.id, session.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
