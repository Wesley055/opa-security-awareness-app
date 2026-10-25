import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  dbTime,
  eligibleAccount,
  guardianScopeAllowed,
  lockJourney,
  scopeSelect,
} from "./safewalk-policy";

const missing = () => new NotFoundException("SafeWalk resource not found.");
const hash = (code: string) => createHash("sha256").update(code).digest("hex");

/** No I, L, O, U, 0 or 1: easy to read out over the phone. */
export const SHORT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export const SHORT_CODE_LENGTH = 8;
/** Wrong codes allowed per journey in 10 minutes before pairing pauses. */
export const MAX_REJECTED_CODES = 5;

export function generateShortCode(pick: (n: number) => number = randomInt): string {
  let out = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) out += SHORT_CODE_ALPHABET[pick(SHORT_CODE_ALPHABET.length)];
  return out;
}

/** Accepts "abcd efgh", "ABCD-EFGH" and the old 64-character codes. */
export function normalizeGuardianCode(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-f0-9]{64}$/.test(trimmed)) return trimmed;
  const short = trimmed.toUpperCase().replace(/[\s-]/g, "");
  return short.length === SHORT_CODE_LENGTH && [...short].every((c) => SHORT_CODE_ALPHABET.includes(c)) ? short : null;
}

@Injectable()
export class SafeWalkGuardianService {
  constructor(private readonly prisma: PrismaService) {}

  async issueCode(guardianId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${guardianId}))`;
      const guardian = await tx.user.findUnique({
        where: { id: guardianId },
        select: scopeSelect,
      });
      if (!eligibleAccount(guardian)) throw missing();
      const now = await dbTime(tx);
      const pending = await tx.safeWalkGuardianCode.count({
        where: { userId: guardianId, consumedAt: null, expiresAt: { gt: now } },
      });
      if (pending >= 5)
        throw new ConflictException("Too many pending SafeWalk pairing codes.");
      const code = generateShortCode();
      const expiresAt = new Date(now.getTime() + 10 * 60_000);
      await tx.safeWalkGuardianCode.create({
        data: { userId: guardianId, codeHash: hash(code), expiresAt },
      });
      return { code, expiresAt };
    });
  }

  async authorize(ownerId: string, sessionId: string, input: string) {
    const code = normalizeGuardianCode(input);
    if (!code) throw missing();
    // Short codes are guessable in bulk, so wrong guesses are limited per journey.
    const rejected = await this.prisma.safeWalkAudit.count({
      where: { sessionId, kind: "GUARDIAN_CODE_REJECTED", occurredAt: { gt: new Date(Date.now() - 10 * 60_000) } },
    });
    if (rejected >= MAX_REJECTED_CODES)
      throw new HttpException("Too many wrong codes. Wait 10 minutes and try again.", HttpStatus.TOO_MANY_REQUESTS);
    try {
      return await this.authorizeCode(ownerId, sessionId, code);
    } catch (error) {
      if (error instanceof NotFoundException) {
        const own = await this.prisma.journeySession.findFirst({ where: { id: sessionId, userId: ownerId }, select: { id: true } });
        if (own)
          await this.prisma.safeWalkAudit
            .create({ data: { sessionId, actorUserId: ownerId, eventKey: sessionId + ":code-rejected:" + randomUUID(), kind: "GUARDIAN_CODE_REJECTED", reasonCode: "CODE_NOT_ACCEPTED" } })
            .catch(() => undefined);
      }
      throw error;
    }
  }

  private async authorizeCode(ownerId: string, sessionId: string, code: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockJourney(tx, ownerId, sessionId);
      const session = await tx.journeySession.findFirst({
        where: {
          id: sessionId,
          userId: ownerId,
          purpose: "SAFEWALK",
          redactedAt: null,
          status: { in: ["STARTED", "ACTIVE"] },
        },
      });
      if (!session) throw missing();
      const pairing = await tx.safeWalkGuardianCode.findUnique({
        where: { codeHash: hash(code) },
      });
      const now = await dbTime(tx);
      if (
        !pairing ||
        pairing.expiresAt <= now ||
        (pairing.consumedAt && pairing.consumedForSessionId !== sessionId)
      )
        throw missing();
      const owner = await tx.user.findUnique({
        where: { id: ownerId },
        select: scopeSelect,
      });
      const guardian = await tx.user.findUnique({
        where: { id: pairing.userId },
        select: scopeSelect,
      });
      if (!guardianScopeAllowed(owner, guardian, owner?.facilityId ?? null))
        throw missing();
      const existing = await tx.safeWalkGuardianGrant.findUnique({
        where: {
          sessionId_guardianUserId: {
            sessionId,
            guardianUserId: pairing.userId,
          },
        },
      });
      if (
        existing &&
        (existing.revokedAt || existing.facilityScopeId !== owner!.facilityId)
      )
        throw missing(); // revocation is terminal for this journey
      if (pairing.consumedAt) {
        if (!existing) throw missing();
        return this.grantView(existing);
      }
      if (
        !existing &&
        (await tx.safeWalkGuardianGrant.count({ where: { sessionId } })) >= 5
      ) {
        throw new ConflictException(
          "A SafeWalk supports up to five selected guardians.",
        );
      }
      const consumed = await tx.safeWalkGuardianCode.updateMany({
        where: { id: pairing.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now, consumedForSessionId: sessionId },
      });
      if (consumed.count !== 1) throw missing();
      if (existing) return this.grantView(existing);
      const grant = await tx.safeWalkGuardianGrant.create({
        data: {
          sessionId,
          ownerUserId: ownerId,
          guardianUserId: pairing.userId,
          facilityScopeId: owner!.facilityId,
          grantedAt: now,
        },
      });
      await tx.safeWalkAudit.create({
        data: {
          sessionId,
          actorUserId: ownerId,
          grantId: grant.id,
          eventKey: grant.id + ":authorized",
          kind: "GUARDIAN_AUTHORIZED",
          reasonCode: "OWNER_SELECTED_STATUS_ONLY",
          occurredAt: now,
        },
      });
      return this.grantView(grant);
    });
  }

  private grantView(grant: {
    id: string;
    grantedAt: Date;
    policyVersion: string;
  }) {
    return {
      grantId: grant.id,
      grantedAt: grant.grantedAt,
      scope: "STATUS_ONLY",
      policyVersion: grant.policyVersion,
    };
  }

  async revoke(ownerId: string, sessionId: string, grantId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockJourney(tx, ownerId, sessionId);
      const grant = await tx.safeWalkGuardianGrant.findFirst({
        where: { id: grantId, sessionId, ownerUserId: ownerId },
      });
      if (!grant) throw missing();
      if (grant.revokedAt) return { revokedAt: grant.revokedAt };
      const now = await dbTime(tx);
      await tx.safeWalkGuardianGrant.update({
        where: { id: grant.id },
        data: { revokedAt: now },
      });
      await tx.safeWalkNotice.updateMany({
        where: { grantId, cancelledAt: null },
        data: { cancelledAt: now },
      });
      await tx.safeWalkAudit.create({
        data: {
          sessionId,
          actorUserId: ownerId,
          grantId,
          eventKey: grantId + ":revoked",
          kind: "GUARDIAN_REVOKED",
          reasonCode: "OWNER_REVOKED",
          occurredAt: now,
        },
      });
      return { revokedAt: now };
    });
  }

  async authorizedGrant(
    tx: Prisma.TransactionClient,
    guardianId: string,
    sessionId: string,
  ) {
    const grant = await tx.safeWalkGuardianGrant.findUnique({
      where: {
        sessionId_guardianUserId: { sessionId, guardianUserId: guardianId },
      },
    });
    if (
      !grant ||
      grant.revokedAt ||
      grant.policyVersion !== "safewalk-status-v1"
    )
      return null;
    const owner = await tx.user.findUnique({
      where: { id: grant.ownerUserId },
      select: scopeSelect,
    });
    const guardian = await tx.user.findUnique({
      where: { id: guardianId },
      select: scopeSelect,
    });
    return guardianScopeAllowed(owner, guardian, grant.facilityScopeId)
      ? grant
      : null;
  }

  async sharedStatus(guardianId: string, sessionId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Lookup only identifies the lock; it never authorizes the read.
      const hint = await tx.safeWalkGuardianGrant.findUnique({
        where: {
          sessionId_guardianUserId: { sessionId, guardianUserId: guardianId },
        },
      });
      if (!hint) throw missing();
      await lockJourney(tx, hint.ownerUserId, sessionId);
      const grant = await this.authorizedGrant(tx, guardianId, sessionId);
      if (!grant) throw missing();
      const session = await tx.journeySession.findFirst({
        where: {
          id: sessionId,
          userId: grant.ownerUserId,
          purpose: "SAFEWALK",
          redactedAt: null,
        },
        select: {
          id: true,
          status: true,
          expectedArrivalAt: true,
          safetyConfirmedAt: true,
          arrivalConfirmedAt: true,
        },
      });
      if (!session) throw missing();
      await tx.safeWalkAudit.create({
        data: {
          sessionId,
          actorUserId: guardianId,
          grantId: grant.id,
          eventKey: randomUUID(),
          kind: "GUARDIAN_READ",
          reasonCode: "OWNER_SELECTED_STATUS_ONLY",
        },
      });
      return { ...session, scope: "STATUS_ONLY" };
    });
  }

  private async visibleNotice(
    tx: Prisma.TransactionClient,
    recipientId: string,
    noticeId: string,
  ) {
    const notice = await tx.safeWalkNotice.findFirst({
      where: { id: noticeId, recipientUserId: recipientId, cancelledAt: null },
    });
    if (!notice) return null;
    const session = await tx.journeySession.findUnique({
      where: { id: notice.sessionId },
    });
    if (!session) return null;
    await lockJourney(tx, session.userId, session.id);
    // Recheck after locking against concurrent confirmation or revocation.
    const current = await tx.safeWalkNotice.findFirst({
      where: { id: notice.id, recipientUserId: recipientId, cancelledAt: null },
    });
    const live = await tx.journeySession.findUnique({
      where: { id: session.id },
    });
    if (
      !current ||
      !live ||
      live.purpose !== "SAFEWALK" ||
      live.redactedAt ||
      live.status === "ENDED" ||
      live.safetyConfirmedAt ||
      live.arrivalConfirmedAt
    )
      return null;
    if (notice.kind === "OWNER_CHECK") {
      const owner = await tx.user.findUnique({
        where: { id: recipientId },
        select: scopeSelect,
      });
      if (
        session.userId !== recipientId ||
        !eligibleAccount(owner) ||
        notice.grantId !== null
      )
        return null;
    } else {
      const grant = await this.authorizedGrant(tx, recipientId, session.id);
      if (!grant || grant.id !== notice.grantId) return null;
    }
    return current;
  }

  async inbox(recipientId: string) {
    const candidates = await this.prisma.safeWalkNotice.findMany({
      where: { recipientUserId: recipientId, cancelledAt: null },
      orderBy: [{ availableAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true },
    });
    const notices = [];
    // One journey lock per transaction avoids cross-journey lock cycles.
    for (const candidate of candidates) {
      const item = await this.prisma.$transaction(async (tx) => {
        const notice = await this.visibleNotice(tx, recipientId, candidate.id);
        if (!notice) return null;
        await tx.safeWalkAudit.create({
          data: {
            sessionId: notice.sessionId,
            actorUserId: recipientId,
            grantId: notice.grantId,
            eventKey: randomUUID(),
            kind: "NOTICE_READ",
            reasonCode: notice.reasonCode,
          },
        });
        return {
          id: notice.id,
          sessionId: notice.sessionId,
          kind: notice.kind,
          message: notice.message,
          availableAt: notice.availableAt,
          acknowledgedAt: notice.acknowledgedAt,
          deliveryEvidence: "IN_APP_AVAILABLE",
        };
      });
      if (item) notices.push(item);
    }
    return notices;
  }

  async acknowledge(recipientId: string, noticeId: string) {
    return this.prisma.$transaction(async (tx) => {
      const notice = await this.visibleNotice(tx, recipientId, noticeId);
      if (!notice) throw missing();
      if (notice.acknowledgedAt)
        return { acknowledgedAt: notice.acknowledgedAt };
      const now = await dbTime(tx);
      await tx.safeWalkNotice.update({
        where: { id: notice.id },
        data: { acknowledgedAt: now },
      });
      await tx.safeWalkAudit.create({
        data: {
          sessionId: notice.sessionId,
          actorUserId: recipientId,
          grantId: notice.grantId,
          eventKey: notice.id + ":ack",
          kind: "NOTICE_ACKNOWLEDGED",
          reasonCode: "RECIPIENT_ACKNOWLEDGED",
          occurredAt: now,
        },
      });
      return { acknowledgedAt: now };
    });
  }
}
