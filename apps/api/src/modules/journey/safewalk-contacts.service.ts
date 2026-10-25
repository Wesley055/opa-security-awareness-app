import { HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { sendFromShortcode } from "../emergency-delivery/sms-reply";
import { toE164 } from "../../shared/phone/normalize-phone-number";
import { contactPhoneHash, CONSENT_INVITE_VALID_MS, inviteText, safeWalkEnabled } from "./safewalk-consent";
import { eligibleAccount, scopeSelect } from "./safewalk-policy";

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_INVITES_PER_CONTACT_PER_DAY = 3;
export const MAX_INVITES_PER_USER_PER_DAY = 10;

export type ContactSafeWalkState = "NOT_ASKED" | "WAITING" | "READY" | "DECLINED" | "NUMBER_CHANGED";

/**
 * SafeWalk contacts are the person's own emergency contacts. A contact only
 * receives SafeWalk texts after replying YES from the invited number.
 */
@Injectable()
export class SafeWalkContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const contacts = await this.prisma.emergencyContact.findMany({
      where: { userId, isActive: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { id: true, firstName: true, lastName: true, relationship: true, phoneNumber: true, safeWalkConsent: true },
    });
    const now = Date.now();
    return contacts.map((c) => ({
      contactId: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      relationship: c.relationship,
      safeWalk: stateOf(c.safeWalkConsent, contactPhoneHash(c.phoneNumber), now),
    }));
  }

  async invite(userId: string, contactId: string, now = new Date()) {
    if (!safeWalkEnabled()) throw new ServiceUnavailableException("SafeWalk isn't available yet.");
    const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { ...scopeSelect, firstName: true } });
    if (!eligibleAccount(owner)) throw new NotFoundException("Contact not found.");
    const contact = await this.prisma.emergencyContact.findFirst({
      where: { id: contactId, userId, isActive: true },
      select: { id: true, phoneNumber: true, safeWalkConsent: true },
    });
    if (!contact) throw new NotFoundException("Contact not found.");
    const phoneHash = contactPhoneHash(contact.phoneNumber);
    if (!phoneHash) throw new HttpException("This contact's phone number can't receive texts. Check the number.", HttpStatus.UNPROCESSABLE_ENTITY);
    const existing = contact.safeWalkConsent;
    if (existing?.status === "CONSENTED" && existing.phoneHash === phoneHash) return { contactId, safeWalk: "READY" as const, sent: false };
    if (existing?.status === "DECLINED" && existing.phoneHash === phoneHash)
      throw new HttpException("This contact replied STOP. They need to text YES to the OPA number to change that.", HttpStatus.CONFLICT);

    const sameDay = existing && now.getTime() - existing.invitedAt.getTime() < DAY_MS;
    if (sameDay && existing.inviteCount >= MAX_INVITES_PER_CONTACT_PER_DAY)
      throw new HttpException("You've asked this contact 3 times today. Try again tomorrow.", HttpStatus.TOO_MANY_REQUESTS);
    const today = await this.prisma.safeWalkContactConsent.count({ where: { userId, invitedAt: { gt: new Date(now.getTime() - DAY_MS) } } });
    if (!sameDay && today >= MAX_INVITES_PER_USER_PER_DAY)
      throw new HttpException("You've sent the most invitations allowed today. Try again tomorrow.", HttpStatus.TOO_MANY_REQUESTS);

    await this.prisma.safeWalkContactConsent.upsert({
      where: { emergencyContactId: contactId },
      create: { userId, emergencyContactId: contactId, phoneHash, invitedAt: now },
      update: { phoneHash, status: "PENDING", respondedAt: null, invitedAt: now, inviteCount: sameDay ? { increment: 1 } : 1 },
    });
    const sent = await sendFromShortcode(toE164(contact.phoneNumber), inviteText(owner!.firstName || "An OPA user"));
    return { contactId, safeWalk: "WAITING" as const, sent: sent === "SENT" };
  }

  /** The owner removes a contact from SafeWalk. Texts not yet sent are cancelled. */
  async remove(userId: string, contactId: string, now = new Date()) {
    const consent = await this.prisma.safeWalkContactConsent.findFirst({ where: { emergencyContactId: contactId, userId } });
    if (!consent) return { contactId, safeWalk: "NOT_ASKED" as const };
    await this.prisma.$transaction([
      this.prisma.safeWalkContactConsent.update({ where: { id: consent.id }, data: { status: "REVOKED" } }),
      this.prisma.safeWalkContactNotice.updateMany({
        where: { consentId: consent.id, status: { in: ["SELECTED", "QUEUED"] } },
        data: { status: "CANCELLED", cancelledAt: now },
      }),
    ]);
    return { contactId, safeWalk: "NOT_ASKED" as const };
  }
}

export function stateOf(
  consent: { status: string; phoneHash: string; invitedAt: Date } | null,
  currentHash: string | null,
  now: number,
): ContactSafeWalkState {
  if (!consent || consent.status === "REVOKED") return "NOT_ASKED";
  if (currentHash && consent.phoneHash !== currentHash) return "NUMBER_CHANGED";
  if (consent.status === "CONSENTED") return "READY";
  if (consent.status === "DECLINED") return "DECLINED";
  return now - consent.invitedAt.getTime() < CONSENT_INVITE_VALID_MS ? "WAITING" : "NOT_ASKED";
}
