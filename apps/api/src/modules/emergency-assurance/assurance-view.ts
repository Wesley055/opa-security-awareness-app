import type { PrismaClient } from "@prisma/client";

export interface AssuranceView {
  contactsAlerted: number;
  contactsConfirmed: { relationship: string; at: string; via: string }[];
  remindersSent: number;
  callsPlaced: number;
  securityEscalatedAt: string | null;
  facilityAdminsAlerted: number;
}

/**
 * For the duty officer: who confirmed seeing the alert, by relationship only
 * ("Sister at 14:03"), never by name or number.
 */
export async function assuranceView(prisma: Pick<PrismaClient, "incidentContactAssurance" | "incidentSecurityEscalation">, incidentId: string): Promise<AssuranceView | null> {
  const [rows, escalation] = await Promise.all([
    prisma.incidentContactAssurance.findMany({ where: { incidentId }, select: { relationship: true, confirmedAt: true, confirmedVia: true, reminderSentAt: true, voiceCallAt: true }, orderBy: { confirmedAt: "asc" } }),
    prisma.incidentSecurityEscalation.findUnique({ where: { incidentId }, select: { notifiedAt: true, sent: true } }),
  ]);
  if (!rows.length && !escalation) return null;
  return {
    contactsAlerted: rows.length,
    contactsConfirmed: rows.filter((r) => r.confirmedAt).map((r) => ({ relationship: r.relationship, at: r.confirmedAt!.toISOString(), via: r.confirmedVia ?? "SMS_REPLY" })),
    remindersSent: rows.filter((r) => r.reminderSentAt).length,
    callsPlaced: rows.filter((r) => r.voiceCallAt).length,
    securityEscalatedAt: escalation?.notifiedAt.toISOString() ?? null,
    facilityAdminsAlerted: escalation?.sent ?? 0,
  };
}
