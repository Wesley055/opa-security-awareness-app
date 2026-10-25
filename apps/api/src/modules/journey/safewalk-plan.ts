import type { Prisma } from "@prisma/client";
import type { StartSessionDto } from "./dto/start-session.dto";
import { contactPhoneHash } from "./safewalk-consent";

/**
 * Writes the Nigeria-first detail for a new SafeWalk, in the same transaction
 * that creates the journey. Only contacts who replied YES from their current
 * number are attached; anyone else is silently left out and never texted.
 */
export async function createSafeWalkPlan(tx: Prisma.TransactionClient, userId: string, sessionId: string, dto: StartSessionDto): Promise<number> {
  await tx.safeWalkPlan.create({
    data: {
      sessionId,
      userId,
      destinationKind: dto.destinationKind!,
      placeId: dto.destinationKind === "PLACE" ? dto.placeId ?? null : null,
      destinationDescription: dto.destinationKind === "DESCRIPTION" ? dto.destinationDescription ?? null : null,
      arrivalRadiusMeters: dto.arrivalRadiusMeters ?? 100,
    },
  });
  const wanted = [...new Set(dto.contactIds ?? [])].slice(0, 5);
  if (!wanted.length) return 0;
  const contacts = await tx.emergencyContact.findMany({
    where: { id: { in: wanted }, userId, isActive: true, safeWalkConsent: { status: "CONSENTED" } },
    select: { phoneNumber: true, safeWalkConsent: { select: { id: true, phoneHash: true } } },
  });
  const ready = contacts.filter((c) => c.safeWalkConsent && contactPhoneHash(c.phoneNumber) === c.safeWalkConsent.phoneHash);
  if (ready.length) await tx.safeWalkContactNotice.createMany({ data: ready.map((c) => ({ sessionId, consentId: c.safeWalkConsent!.id })) });
  return ready.length;
}
