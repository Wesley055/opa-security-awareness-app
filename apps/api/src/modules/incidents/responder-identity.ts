import { Logger } from "@nestjs/common";
import { IncidentStatus, UserRole } from "@prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import { maskedPerson } from "../protected-identity/masked-person";

/**
 * Responder name visibility (owner decision, 19 Oct 2026).
 *
 * During an ACTIVE incident, the resident's first and last name are shown to
 * active Facility Admins and Facility Operators of the SAME facility, so they
 * know who is in danger. Everything else stays masked (email, phone), closed
 * incidents stay masked, and OPA staff (Super Admin, Technical Support) never
 * qualify here: they see names only through audited Temporary Access.
 *
 * Each staff member's first view of a resident's name on an incident is
 * recorded once as INCIDENT_IDENTITY_VIEWED (no name in the audit row).
 */
export const RESPONDER_VISIBLE_STATUSES: IncidentStatus[] = [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED];
const RESPONDER_ROLES: UserRole[] = [UserRole.FACILITY_ADMIN, UserRole.FACILITY_OPERATOR];
export const IDENTITY_VIEWED = "INCIDENT_IDENTITY_VIEWED";

type Db = Pick<PrismaService, "user" | "administrativeAuditEvent">;
export type Responder = { id: string; role: UserRole; facilityId: string };

export async function facilityResponder(db: Db, viewerId: string | undefined, facilityId: string | null | undefined): Promise<Responder | null> {
  if (!viewerId || !facilityId) return null;
  const viewer = await db.user.findUnique({
    where: { id: viewerId },
    select: { id: true, role: true, facilityId: true, isActive: true, membershipState: true },
  });
  if (!viewer || !viewer.isActive || viewer.membershipState !== "ACTIVE") return null;
  if (!RESPONDER_ROLES.includes(viewer.role) || viewer.facilityId !== facilityId) return null;
  return { id: viewer.id, role: viewer.role, facilityId };
}

/** Name shown only to a responder while the incident is active; all else masked. */
export function responderPerson<T extends { firstName?: string | null; lastName?: string | null } | null>(
  person: T,
  status: IncidentStatus,
  responder: Responder | null,
): T {
  if (!person) return person;
  const masked = maskedPerson(person);
  if (!responder || !RESPONDER_VISIBLE_STATUSES.includes(status)) return masked;
  return { ...masked, firstName: person.firstName, lastName: person.lastName };
}

/** Records the first view per responder per incident. Never throws into the read. */
export async function recordIdentityViews(db: Db, responder: Responder | null, incidentIds: string[]): Promise<void> {
  if (!responder || incidentIds.length === 0) return;
  try {
    const seen = await db.administrativeAuditEvent.findMany({
      where: { actorUserId: responder.id, action: IDENTITY_VIEWED, resourceId: { in: incidentIds } },
      select: { resourceId: true },
    });
    const done = new Set(seen.map(row => row.resourceId));
    const fresh = incidentIds.filter(id => !done.has(id));
    if (fresh.length === 0) return;
    await db.administrativeAuditEvent.createMany({
      data: fresh.map(id => ({
        actorUserId: responder.id,
        actorRole: responder.role,
        action: IDENTITY_VIEWED,
        resourceId: id,
        facilityId: responder.facilityId,
        reason: "Resident name shown to facility responder during an active incident.",
      })),
    });
  } catch (error) {
    // An audit write failure must not hide an emergency from its responder.
    new Logger("ResponderIdentity").error(`identity-view audit failed: ${error instanceof Error ? error.name : "unknown"}`);
  }
}
