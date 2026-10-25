import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { SmsProvider } from "../notifications/providers/sms.provider";
import { watClock } from "../emergency-delivery/sms-reply";
import { toE164 } from "../../shared/phone/normalize-phone-number";
import { contactPhoneHash } from "./safewalk-consent";
import { dbTime, eligibleAccount, lockJourney, scopeSelect } from "./safewalk-policy";

export const CONTACT_NOTICE_MAX_ATTEMPTS = 3;
const RETRY_MS = 60_000;

export function contactOverdueText(input: {
  ownerFirstName: string;
  destination: string;
  expectedArrivalAt: Date | null;
  lastFix: { latitude: number; longitude: number; recordedAt: Date } | null;
}): string {
  const who = input.ownerFirstName || "Your contact";
  const when = input.expectedArrivalAt ? ` (expected ${watClock(input.expectedArrivalAt)} WAT)` : "";
  const where = input.lastFix
    ? ` Last location at ${watClock(input.lastFix.recordedAt)} WAT: https://maps.google.com/?q=${input.lastFix.latitude.toFixed(5)},${input.lastFix.longitude.toFixed(5)}`
    : " No recent location.";
  return `OPA SafeWalk: ${who} has not confirmed arriving safely at ${input.destination.slice(0, 60)}${when}.${where} Please try to call ${who}. This is not an emergency alert.`;
}

/**
 * Sends the one overdue text to each contact who replied YES. Nothing is sent
 * once the person confirms, cancels, raises an SOS, or the contact withdraws.
 */
@Injectable()
export class SafeWalkContactNoticeWorker {
  private readonly logger = new Logger(SafeWalkContactNoticeWorker.name);
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly sms: SmsProvider) {}

  @Interval(3000)
  async tick() {
    if (this.running || process.env.SAFEWALK_ESCALATION_ENABLED !== "true") return;
    this.running = true;
    try {
      const due = await this.prisma.safeWalkContactNotice.findMany({
        where: { status: "QUEUED", nextAttemptAt: { lte: new Date() } },
        orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
        take: 25,
        select: { id: true },
      });
      for (const notice of due) await this.dispatch(notice.id);
    } catch {
      this.logger.error("SafeWalk contact notice batch failed; state retained for retry.");
    } finally {
      this.running = false;
    }
  }

  async dispatch(id: string): Promise<"SENT" | "RETRY" | "FAILED" | "CANCELLED" | "SKIPPED"> {
    const work = await this.prisma.$transaction(async (tx) => {
      const hint = await tx.safeWalkContactNotice.findUnique({ where: { id }, select: { sessionId: true, plan: { select: { userId: true } } } });
      if (!hint) return null;
      await lockJourney(tx, hint.plan.userId, hint.sessionId);
      const now = await dbTime(tx);
      const notice = await tx.safeWalkContactNotice.findUnique({
        where: { id },
        include: { consent: { include: { emergencyContact: { select: { phoneNumber: true, isActive: true, userId: true } } } } },
      });
      if (!notice || notice.status !== "QUEUED" || !notice.nextAttemptAt || notice.nextAttemptAt > now) return null;
      const session = await tx.journeySession.findUnique({ where: { id: notice.sessionId } });
      const owner = session ? await tx.user.findUnique({ where: { id: session.userId }, select: { ...scopeSelect, firstName: true } }) : null;
      const contact = notice.consent.emergencyContact;
      const allowed =
        !!session &&
        eligibleAccount(owner) &&
        session.purpose === "SAFEWALK" &&
        !session.redactedAt &&
        !session.safeWalkEmergencyIncidentId &&
        !session.safetyConfirmedAt &&
        !session.arrivalConfirmedAt &&
        session.status !== "ENDED" &&
        notice.consent.status === "CONSENTED" &&
        contact.isActive &&
        contact.userId === session.userId &&
        contactPhoneHash(contact.phoneNumber) === notice.consent.phoneHash;
      if (!allowed) {
        await tx.safeWalkContactNotice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now } });
        return "CANCELLED" as const;
      }
      // Claim: a crashed send is retried at most once a minute, never in parallel.
      await tx.safeWalkContactNotice.update({ where: { id }, data: { attemptCount: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + RETRY_MS) } });
      const fix = await tx.journeyLocationFix.findFirst({
        where: { journeySessionId: session!.id, latitude: { not: null }, longitude: { not: null } },
        orderBy: { recordedAt: "desc" },
        select: { latitude: true, longitude: true, recordedAt: true },
      });
      return {
        to: toE164(contact.phoneNumber),
        attempt: notice.attemptCount + 1,
        message: contactOverdueText({
          ownerFirstName: owner!.firstName,
          destination: session!.destinationLabel ?? "their destination",
          expectedArrivalAt: session!.expectedArrivalAt,
          lastFix: fix ? { latitude: Number(fix.latitude), longitude: Number(fix.longitude), recordedAt: fix.recordedAt } : null,
        }),
        sessionId: session!.id,
      };
    });
    if (!work) return "SKIPPED";
    if (work === "CANCELLED") return "CANCELLED";
    const result = await this.sms.send({ recipient: work.to, message: work.message });
    if (result.success) {
      await this.prisma.safeWalkContactNotice.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: result.messageId?.slice(0, 120) ?? null, nextAttemptAt: null } });
      await this.prisma.safeWalkAudit.create({ data: { sessionId: work.sessionId, eventKey: id + ":sent", kind: "CONTACT_NOTICE_SENT", reasonCode: "SAFETY_CHECK_UNANSWERED" } }).catch(() => undefined);
      return "SENT";
    }
    const final = !result.retryable || work.attempt >= CONTACT_NOTICE_MAX_ATTEMPTS;
    await this.prisma.safeWalkContactNotice.update({
      where: { id },
      data: final
        ? { status: "FAILED", failureCategory: String(result.failureCategory ?? "UNKNOWN").slice(0, 40), nextAttemptAt: null }
        : { failureCategory: String(result.failureCategory ?? "UNKNOWN").slice(0, 40) },
    });
    return final ? "FAILED" : "RETRY";
  }
}
