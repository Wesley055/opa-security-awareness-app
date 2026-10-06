export const ELEVATED_CAPABILITIES: readonly string[] = [
  "INCIDENT_RESOLVE",
  "RESIDENT_SUPPORT_OVERRIDE",
  "FACILITY_ADMIN_DEPROVISION",
  "STAFF_RECOVER_ACCESS",
];
import { ForbiddenException } from "@nestjs/common";
import type { Prisma, SupportCapability } from "@prisma/client";
export type Authority = {
  actorRole: string;
  authority: string;
  grantId: string | null;
  assignmentId?: string;
  elevationId?: string;
  supportCaseId?: string;
  provisioningMode?: "FIRST_FACILITY_ADMIN";
};
export async function supportAuthority(
  tx: Prisma.TransactionClient,
  actorId: string,
  capability: SupportCapability,
  facilityId: string | null,
  caseReference?: string,
): Promise<Authority> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId}::uuid FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor?.isActive || actor.accountStatus !== "ACTIVE")
    throw new ForbiddenException("Current authority required.");
  if (facilityId) {
    await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR SHARE`;
    const facility = await tx.facility.findUnique({
      where: { id: facilityId },
    });
    if (
      !facility?.isActive ||
      ["SUSPENDED", "DECOMMISSIONED"].includes(facility.operationalState)
    )
      throw new ForbiddenException("Current authority required.");
  }
  if (actor.role === "ADMIN")
    return {
      actorRole: actor.role,
      authority: "PLATFORM_ADMIN",
      grantId: null,
    };
  if (actor.role !== "TECHNICAL_SUPPORT" || actor.facilityId !== null)
    throw new ForbiddenException("Support capability required.");
  await tx.$queryRaw`SELECT "userId" FROM "SupportEmployment" WHERE "userId"=${actorId}::uuid FOR SHARE`;
  const employment = await tx.supportEmployment.findUnique({
    where: { userId: actorId },
  });
  if (employment?.state !== "ACTIVE")
    throw new ForbiddenException("Support capability required.");
  let assignmentId: string | undefined;
  if (facilityId) {
    const assignments = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "FacilitySupportAssignment" WHERE "actorUserId"=${actorId}::uuid AND "facilityId"=${facilityId}::uuid AND "revokedAt" IS NULL FOR SHARE`;
    if (!assignments[0])
      throw new ForbiddenException("Current OPA Support Assignment required.");
    assignmentId = assignments[0].id;
  }
  let supportCaseId: string | undefined;
  let elevationId: string | undefined;
  if (
    caseReference ||
    ELEVATED_CAPABILITIES.includes(capability) ||
    capability === "PII_RESOLVE"
  ) {
    if (!facilityId || !caseReference)
      throw new ForbiddenException(
        "A current facility Support Case is required.",
      );
    const cases = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "SupportCase" WHERE id=${caseReference}::uuid AND "facilityId"=${facilityId}::uuid AND "assignedToUserId"=${actorId}::uuid AND status IN ('OPEN','INVESTIGATING') FOR SHARE`;
    if (!cases[0])
      throw new ForbiddenException(
        "A current assigned Support Case is required.",
      );
    supportCaseId = cases[0].id;
    if (ELEVATED_CAPABILITIES.includes(capability)) {
      const elevations = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "TemporaryElevation" WHERE "actorUserId"=${actorId}::uuid AND "facilityId"=${facilityId}::uuid AND "supportCaseId"=${supportCaseId}::uuid AND capability=${capability}::"SupportCapability" AND "revokedAt" IS NULL AND "startsAt"<=clock_timestamp() AND "expiresAt">clock_timestamp() ORDER BY id LIMIT 1 FOR SHARE`;
      if (!elevations[0])
        throw new ForbiddenException("Current Temporary Elevation required.");
      elevationId = elevations[0].id;
    }
  }
  const grants = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "SupportCapabilityGrant" WHERE "actorUserId"=${actorId}::uuid AND capability=${capability}::"SupportCapability" AND "facilityId" IS NOT DISTINCT FROM ${facilityId}::uuid AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt">clock_timestamp()) ORDER BY id LIMIT 1 FOR SHARE`;
  if (!grants[0]) throw new ForbiddenException("Support capability required.");
  return {
    actorRole: actor.role,
    authority: "SUPPORT_CAPABILITY",
    grantId: grants[0].id,
    assignmentId,
    elevationId,
    supportCaseId,
  };
}
export async function institutionalAuthority(
  tx: Prisma.TransactionClient,
  actorId: string,
  facilityId: string,
  capability: SupportCapability,
  caseReference?: string,
): Promise<Authority> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId}::uuid FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (
    actor?.role === "FACILITY_ADMIN" &&
    actor.isActive &&
    actor.accountStatus === "ACTIVE" &&
    actor.facilityId === facilityId &&
    actor.membershipState === "ACTIVE"
  ) {
    await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR SHARE`;
    const facility = await tx.facility.findUnique({
      where: { id: facilityId },
    });
    if (
      facility?.isActive &&
      !["SUSPENDED", "DECOMMISSIONED"].includes(facility.operationalState)
    )
      return {
        actorRole: actor.role,
        authority: "FACILITY_ADMIN",
        grantId: null,
      };
  }
  return supportAuthority(tx, actorId, capability, facilityId, caseReference);
}

export type InstitutionalRole =
  "USER" | "FACILITY_ADMIN" | "FACILITY_OPERATOR" | "TECHNICAL_SUPPORT";
export async function enrollmentAuthority(
  tx: Prisma.TransactionClient,
  actorId: string | undefined,
  facilityId: string | null,
  role: InstitutionalRole,
  caseReference?: string,
): Promise<Authority> {
  if (!actorId) throw new ForbiddenException("Enrollment authority required.");
  if (role === "TECHNICAL_SUPPORT") {
    if (facilityId)
      throw new ForbiddenException(
        "Support employees cannot be tenant members.",
      );
    const authority = await supportAuthority(
      tx,
      actorId,
      "FACILITY_READ",
      null,
    );
    if (authority.actorRole !== "ADMIN")
      throw new ForbiddenException("Platform authority required.");
    return authority;
  }
  if (!facilityId) throw new ForbiddenException("Facility required.");
  // All enrollment writers serialize first-admin activation before facility row locks.
  if (role === "FACILITY_ADMIN")
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(15, hashtext(${facilityId}))`;
  // Keep the role branch stable through canonical enrollment mutation.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId}::uuid FOR SHARE`;
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });
  if (actor?.role === "TECHNICAL_SUPPORT") {
    if (!caseReference) {
      if (role !== "FACILITY_ADMIN")
        throw new ForbiddenException(
          "Routine staffing belongs to the Facility Admin. Exceptional support requires an assigned Support Case.",
        );
      const authority = await supportAuthority(
        tx,
        actorId,
        "STAFF_PROVISION",
        facilityId,
      );
      const facility = await tx.facility.findUniqueOrThrow({
        where: { id: facilityId },
      });
      if (facility.operationalState !== "COMMISSIONING")
        throw new ForbiddenException(
          "First Facility Administrator provisioning is available only during commissioning.",
        );
      const activeAdmins = await tx.user.count({
        where: {
          facilityId,
          role: "FACILITY_ADMIN",
          isActive: true,
          accountStatus: "ACTIVE",
          membershipState: "ACTIVE",
        },
      });
      if (activeAdmins !== 0)
        throw new ForbiddenException(
          "An active Facility Administrator already exists. Routine staffing belongs to the Facility Admin.",
        );
      return { ...authority, provisioningMode: "FIRST_FACILITY_ADMIN" };
    }
    const capability =
      role === "USER" ? "RESIDENT_SUPPORT_OVERRIDE" : "STAFF_PROVISION";
    const authority = await supportAuthority(
      tx,
      actorId,
      capability,
      facilityId,
      caseReference,
    );
    if (role !== "USER") {
      const elevation = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "TemporaryElevation" WHERE "actorUserId"=${actorId}::uuid AND "facilityId"=${facilityId}::uuid AND "supportCaseId"=${caseReference}::uuid AND capability='STAFF_PROVISION' AND "revokedAt" IS NULL AND "startsAt"<=clock_timestamp() AND "expiresAt">clock_timestamp() ORDER BY id LIMIT 1 FOR SHARE`;
      if (!elevation[0])
        throw new ForbiddenException(
          "Routine staffing belongs to the Facility Admin. Exceptional support provisioning requires Temporary Elevation.",
        );
      authority.elevationId = elevation[0].id;
    }
    return authority;
  }
  if (actor?.role === "FACILITY_ADMIN" || actor?.role === "ADMIN")
    return institutionalAuthority(
      tx,
      actorId,
      facilityId,
      role === "USER" ? "RESIDENT_SUPPORT_OVERRIDE" : "STAFF_PROVISION",
      caseReference,
    );
  if (role === "USER")
    throw new ForbiddenException("Resident administration required.");
  throw new ForbiddenException("Institutional enrollment authority required.");
}

/** Durable request provenance follows the canonical enrollment through delivery and acceptance. */
export async function enrollmentSupportCase(
  tx: Prisma.TransactionClient,
  requestId: string,
  actorId: string | null,
) {
  const row = await tx.administrativeAuditEvent.findFirst({
    where: {
      resourceId: requestId,
      actorUserId: actorId ?? undefined,
      action: "ENROLLMENT_REQUESTED",
    },
    select: { caseReference: true },
  });
  return row?.caseReference ?? undefined;
}
