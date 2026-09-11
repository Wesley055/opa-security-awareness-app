import { randomUUID } from "node:crypto";
import { ProtectedSnapshotsService } from "../protected-identity/protected-snapshots.service";
import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import {
  dbTime,
  deadlines,
  eligibleAccount,
  guardianScopeAllowed,
  lockJourney,
  OWNER_CHECK_MESSAGE,
  GUARDIAN_OVERDUE_MESSAGE,
  responseDeadline,
  scopeSelect,
  settleSafeWalk,
} from "./safewalk-policy";

@Injectable()
export class SafeWalkEscalationService {
  private readonly logger = new Logger(SafeWalkEscalationService.name);
  constructor(private readonly prisma: PrismaService, private readonly snapshots: ProtectedSnapshotsService) {}

  @Interval(1000)
  async tick() {
    // Disabled until a release explicitly enables the inbox workflow.
    if (process.env.SAFEWALK_ESCALATION_ENABLED !== "true") return;
    try {
      await this.runBatch();
    } catch {
      this.logger.error(
        "SafeWalk escalation batch failed; durable work remains eligible for retry.",
      );
    }
  }

  async runBatch() {
    const now = await dbTime(this.prisma);
    const rows = await this.prisma.safeWalkEscalation.findMany({
      where: {
        OR: [
          { state: "SCHEDULED", checkDueAt: { lte: now } },
          { state: "CHECK_REQUIRED", responseDueAt: { lte: now } },
        ],
      },
      orderBy: [{ checkDueAt: "asc" }, { sessionId: "asc" }],
      take: 50,
      select: { sessionId: true },
    });
    for (const row of rows) {
      try {
        await this.processSession(row.sessionId);
      } catch {
        this.logger.error(
          "SafeWalk transition failed; durable work retained for retry.",
        );
      }
    }
    return rows.length;
  }

  async processSession(sessionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const hint = await tx.journeySession.findUnique({
        where: { id: sessionId },
        select: { userId: true },
      });
      if (!hint) return;
      await lockJourney(tx, hint.userId, sessionId);
      const session = await tx.journeySession.findUnique({
        where: { id: sessionId },
      });
      const escalation = await tx.safeWalkEscalation.findUnique({
        where: { sessionId },
      });
      if (
        !session ||
        !escalation ||
        !["SCHEDULED", "CHECK_REQUIRED"].includes(escalation.state)
      )
        return;
      const now = await dbTime(tx);
      const owner = await tx.user.findUnique({
        where: { id: session.userId },
        select: scopeSelect,
      });
      if (
        session.purpose !== "SAFEWALK" ||
        session.status === "ENDED" ||
        session.redactedAt ||
        session.safeWalkEmergencyIncidentId ||
        !eligibleAccount(owner)
      ) {
        await settleSafeWalk(tx, sessionId, now, "CLOSED", null);
        return;
      }
      if (session.safetyConfirmedAt || session.arrivalConfirmedAt) {
        await settleSafeWalk(tx, sessionId, now, "SATISFIED", session.userId);
        return;
      }
      if (!session.expectedArrivalAt) return;
      // ETA is immutable through the public API. Refuse stale/fabricated deadlines.
      const expected = deadlines(session.expectedArrivalAt);
      if (
        expected.checkDueAt.getTime() !== escalation.checkDueAt.getTime() ||
        expected.guardianDueAt.getTime() !== escalation.guardianDueAt.getTime()
      ) {
        throw new Error("SafeWalk deadline invariant failed.");
      }
      if (escalation.state === "SCHEDULED") {
        if (now < escalation.checkDueAt) return;
        const noticeId = randomUUID();
        const recipient = await this.snapshots.safeWalkRecipientData(tx, noticeId, session.userId);
        await tx.safeWalkNotice.create({
          data: {
            id: noticeId, ...recipient,
            sessionId,
            recipientUserId: session.userId,
            kind: "OWNER_CHECK",
            message: OWNER_CHECK_MESSAGE,
            reasonCode: "EXPECTED_ARRIVAL_NOT_CONFIRMED",
            availableAt: now,
          },
        });
        await tx.safeWalkEscalation.update({
          where: { sessionId },
          data: {
            state: "CHECK_REQUIRED",
            checkRequiredAt: now,
            responseDueAt: responseDeadline(escalation.guardianDueAt, now),
          },
        });
        await tx.safeWalkAudit.create({
          data: {
            sessionId,
            eventKey: sessionId + ":check",
            kind: "CHECK_REQUIRED",
            reasonCode: "EXPECTED_ARRIVAL_NOT_CONFIRMED",
            occurredAt: now,
          },
        });
        return;
      }
      if (!escalation.responseDueAt || now < escalation.responseDueAt) return;
      const grants = await tx.safeWalkGuardianGrant.findMany({
        where: {
          sessionId,
          ownerUserId: session.userId,
          revokedAt: null,
          policyVersion: "safewalk-status-v1",
        },
      });
      for (const grant of grants) {
        const guardian = await tx.user.findUnique({
          where: { id: grant.guardianUserId },
          select: scopeSelect,
        });
        if (!guardianScopeAllowed(owner, guardian, grant.facilityScopeId))
          continue;
        const noticeId = randomUUID();
        const recipient = await this.snapshots.safeWalkRecipientData(tx, noticeId, grant.guardianUserId);
        await tx.safeWalkNotice.create({
          data: {
            id: noticeId, ...recipient,
            sessionId,
            recipientUserId: grant.guardianUserId,
            grantId: grant.id,
            kind: "GUARDIAN_OVERDUE",
            message: GUARDIAN_OVERDUE_MESSAGE,
            reasonCode: "SAFETY_CHECK_UNANSWERED",
            availableAt: now,
          },
        });
        await tx.safeWalkAudit.create({
          data: {
            sessionId,
            grantId: grant.id,
            eventKey: grant.id + ":overdue",
            kind: "GUARDIAN_NOTICE_AVAILABLE",
            reasonCode: "SAFETY_CHECK_UNANSWERED",
            occurredAt: now,
          },
        });
      }
      await tx.safeWalkEscalation.update({
        where: { sessionId },
        data: { state: "ESCALATED", escalatedAt: now },
      });
      await tx.safeWalkAudit.create({
        data: {
          sessionId,
          eventKey: sessionId + ":escalated",
          kind: "GUARDIAN_ESCALATION_PROCESSED",
          reasonCode: "SAFETY_CHECK_UNANSWERED",
          occurredAt: now,
        },
      });
    });
  }
}
