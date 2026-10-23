import { readSafeWalkEmergencies } from "../incidents/safewalk-emergency-read";
import { humanAccount } from "../protected-identity/human-account";
import {
  providerReadiness,
  requireEnrollmentDeliveryConfiguration,
} from "../notifications/provider-readiness";
import { createHash } from "node:crypto";
import { applyEnrollmentDeliveryAction } from "./enrollment-delivery-action";
import { changeMembership, type ActionContext } from "./membership-lifecycle";
export type { ActionContext } from "./membership-lifecycle";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { type Prisma, type SupportCapability } from "@prisma/client";
import {
  enrollmentAuthority,
  institutionalAuthority,
  supportAuthority,
  type Authority,
} from "./support-authority";
import { platformAuthority } from "./onboarding-authority";
import {
  EnrollmentService,
  type EnrollmentIdentity,
} from "../auth/enrollment.service";
const sensitive = [
  "INCIDENT_RESOLVE",
  "PII_RESOLVE",
  "RESIDENT_SUPPORT_OVERRIDE",
  "FACILITY_ADMIN_DEPROVISION",
  "STAFF_RECOVER_ACCESS",
];
@Injectable()
export class InstitutionalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollment: EnrollmentService,
  ) {}
  private audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    authority: Authority,
    action: string,
    resourceId: string,
    facilityId: string | null,
    context: ActionContext,
    before: Prisma.InputJsonValue,
    after: Prisma.InputJsonValue,
  ) {
    if (!context.reason.trim())
      throw new BadRequestException("Reason required.");
    return tx.administrativeAuditEvent.create({
      data: {
        actorUserId: actorId,
        actorRole: authority.actorRole,
        authorityKind: authority.authority,
        authorityGrantId: authority.grantId,
        action,
        resourceId,
        facilityId,
        reason: context.reason,
        caseReference: context.caseReference,
        correlationId: context.correlationId,
        beforeState: before,
        afterState: {
          ...(typeof after === "object" &&
          after !== null &&
          !Array.isArray(after)
            ? after
            : { value: after }),
          authority: { ...authority },
        },
      },
    });
  }
  private async supportReplay(
    tx: Prisma.TransactionClient,
    actorId: string,
    context: ActionContext,
    action: string,
    payload: unknown,
  ) {
    if (!context.reason.trim())
      throw new BadRequestException("Reason required.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId + ":canonical:" + context.correlationId}))`;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          action,
          payload,
          context.reason,
          context.caseReference,
        ]),
      )
      .digest("hex");
    const prior = await tx.administrativeAuditEvent.findFirst({
      where: { actorUserId: actorId, correlationId: context.correlationId },
    });
    if (
      prior &&
      (prior.action !== action ||
        (prior.afterState as Prisma.JsonObject)?.requestFingerprint !==
          fingerprint)
    )
      throw new ConflictException(
        "Operation reference was already used for a different request.",
      );
    return { prior, fingerprint };
  }
  async supportOperation(actorId: string, correlationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId + ":canonical:" + correlationId}))`;
      const receipt = await tx.administrativeAuditEvent.findFirst({
        where: {
          actorUserId: actorId,
          correlationId,
          action: {
            in: [
              "ENROLLMENT_REQUESTED",
              "SUPPORT_INVITATION_RESEND",
              "SUPPORT_INVITATION_REVOKE",
              "SUPPORT_EMPLOYMENT_ACTIVE",
              "SUPPORT_EMPLOYMENT_SUSPENDED",
              "SUPPORT_EMPLOYMENT_ENDED",
              "SUPPORT_CAPABILITY_GRANTED",
              "SUPPORT_CAPABILITY_REVOKED",
              "SUPPORT_CAPABILITIES_REVOKED",
            ],
          },
        },
        select: { id: true, action: true, resourceId: true, createdAt: true },
      });
      return {
        status: receipt ? "COMMITTED" : "NOT_RECORDED",
        receipt,
        correlationId,
      };
    });
  }
  async revokeSupportGrants(
    actorId: string,
    userId: string,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const { prior, fingerprint } = await this.supportReplay(
        tx,
        actorId,
        context,
        "SUPPORT_CAPABILITIES_REVOKED",
        { userId },
      );
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (
        !user ||
        user.role !== "TECHNICAL_SUPPORT" ||
        user.facilityId !== null ||
        userId === actorId
      )
        throw new ForbiddenException("Support identity required.");
      if (prior) return { revoked: true, id: prior.id };
      const result = await tx.supportCapabilityGrant.updateMany({
        where: { actorUserId: userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const audit = await this.audit(
        tx,
        actorId,
        { actorRole: "ADMIN", authority: "PLATFORM_ADMIN", grantId: null },
        "SUPPORT_CAPABILITIES_REVOKED",
        userId,
        null,
        context,
        {},
        { count: result.count, requestFingerprint: fingerprint },
      );
      return { revoked: true, id: audit.id };
    });
  }
  async deliveryReadiness(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { role: true, facilityId: true },
      });
      if (actor?.role === "FACILITY_ADMIN" && actor.facilityId)
        await institutionalAuthority(
          tx,
          actorId,
          actor.facilityId,
          "DELIVERY_DIAGNOSTICS",
        );
      else await supportAuthority(tx, actorId, "SERVICE_HEALTH_READ", null);
      return providerReadiness();
    });
  }
  async supportInvitationAction(
    actorId: string,
    id: string,
    action: "resend" | "revoke",
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const op = await this.supportReplay(
        tx,
        actorId,
        context,
        "SUPPORT_INVITATION_" + action.toUpperCase(),
        { id, action },
      );
      if (op.prior) return { id, action };
      await tx.$queryRaw`SELECT id FROM "EnrollmentRequest" WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.enrollmentRequest.findUnique({
        where: { id },
        include: { deliveries: true },
      });
      if (
        !row ||
        row.facilityId !== null ||
        row.requestedRole !== "TECHNICAL_SUPPORT"
      )
        throw new NotFoundException("Support invitation not found.");
      if (action === "resend") requireEnrollmentDeliveryConfiguration();
      await applyEnrollmentDeliveryAction(tx, row, action, true);
      await this.audit(
        tx,
        actorId,
        { actorRole: "ADMIN", authority: "PLATFORM_ADMIN", grantId: null },
        "SUPPORT_INVITATION_" + action.toUpperCase(),
        id,
        null,
        context,
        {},
        { action, requestFingerprint: op.fingerprint },
      );
      return { id, action };
    });
  }
  async supportDirectory(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const employees = await tx.user.findMany({
        where: { role: "TECHNICAL_SUPPORT", facilityId: null },
        orderBy: { id: "asc" },
        take: 101,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          facilityId: true,
          isActive: true,
          accountStatus: true,
          supportEmployment: {
            select: {
              state: true,
              appointedByUserId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          supportGrants: {
            orderBy: { createdAt: "desc" },
            take: 101,
            select: {
              id: true,
              capability: true,
              facilityId: true,
              expiresAt: true,
              revokedAt: true,
              approvedByUserId: true,
              reason: true,
              createdAt: true,
            },
          },
        },
      });
      const invitations = await tx.enrollmentRequest.findMany({
        where: {
          requestedRole: "TECHNICAL_SUPPORT",
          facilityId: null,
          acceptedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: 101,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          verifiedAt: true,
          revokedAt: true,
          deliveries: {
            take: 2,
            orderBy: { channel: "asc" },
            select: {
              channel: true,
              status: true,
              deliveryStatus: true,
              attemptCount: true,
              failureCategory: true,
              providerAcceptedAt: true,
              confirmedDeliveredAt: true,
            },
          },
        },
      });
      const facilities = await tx.facility.findMany({
        select: { id: true, name: true, isActive: true },
        orderBy: { id: "asc" },
        take: 101,
      });
      return {
        actor: { id: actorId, role: "ADMIN" },
        employees: employees.slice(0, 100).map((e) => ({
          ...e,
          supportGrants: e.supportGrants.slice(0, 100),
          grantsTruncated: e.supportGrants.length > 100,
        })),
        invitations: invitations.slice(0, 100),
        facilities: facilities.slice(0, 100),
        truncated:
          employees.length > 100 ||
          invitations.length > 100 ||
          facilities.length > 100,
        serverTime: new Date().toISOString(),
      };
    });
  }
  async recoverAccount(
    actorId: string,
    userId: string,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      await platformAuthority(tx, actorId);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (
        !user ||
        userId === actorId ||
        ![
          "USER",
          "FACILITY_ADMIN",
          "FACILITY_OPERATOR",
          "TECHNICAL_SUPPORT",
        ].includes(user.role) ||
        user.accountStatus !== "ACTIVE"
      )
        throw new ForbiddenException(
          "An accepted institutional account is required.",
        );
      const previous = await tx.administrativeAuditEvent.findFirst({
        where: { actorUserId: actorId, correlationId: context.correlationId },
      });
      if (previous) {
        if (
          previous.resourceId !== userId ||
          previous.action !== "PLATFORM_ACCOUNT_RECOVERED" ||
          previous.reason !== context.reason ||
          previous.caseReference !== context.caseReference
        )
          throw new ConflictException("Operation reference already used.");
        return {
          id: userId,
          isActive: user.isActive,
          membershipState: user.membershipState,
        };
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          isActive: true,
          credentialVersion: { increment: 1 },
          activationTokenHash: null,
          activationExpiresAt: null,
        },
      });
      await this.audit(
        tx,
        actorId,
        { actorRole: "ADMIN", authority: "PLATFORM_ADMIN", grantId: null },
        "PLATFORM_ACCOUNT_RECOVERED",
        userId,
        user.facilityId,
        context,
        { isActive: user.isActive, membershipState: user.membershipState },
        {
          isActive: true,
          membershipState: user.membershipState,
          credentialsRevoked: true,
        },
      );
      return {
        id: userId,
        isActive: true,
        membershipState: user.membershipState,
        credentialsRevoked: true,
      };
    });
  }
  async employment(
    actorId: string,
    userId: string,
    state: "ACTIVE" | "SUSPENDED" | "ENDED",
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const { prior, fingerprint } = await this.supportReplay(
        tx,
        actorId,
        context,
        "SUPPORT_EMPLOYMENT_" + state,
        { userId, state },
      );
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (
        !user ||
        user.role !== "TECHNICAL_SUPPORT" ||
        user.facilityId !== null ||
        userId === actorId
      )
        throw new ForbiddenException("Support identity required.");
      if (prior)
        return tx.supportEmployment.findUniqueOrThrow({ where: { userId } });
      const before = await tx.supportEmployment.findUnique({
        where: { userId },
      });
      if (before?.state === "ENDED" && state !== "ENDED")
        throw new ConflictException(
          "Ended employment requires a new reviewed appointment.",
        );
      const result = await tx.supportEmployment.upsert({
        where: { userId },
        create: { userId, state, appointedByUserId: actorId },
        update: { state },
      });
      await tx.user.update({
        where: { id: userId },
        data: { credentialVersion: { increment: 1 } },
      });
      if (state !== "ACTIVE") {
        await tx.facilitySupportAssignment.updateMany({
          where: { actorUserId: userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.temporaryElevation.updateMany({
          where: { actorUserId: userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.supportCapabilityGrant.updateMany({
          where: { actorUserId: userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.onboardingAuthorityGrant.updateMany({
          where: { actorUserId: userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit(
        tx,
        actorId,
        { actorRole: "ADMIN", authority: "PLATFORM_ADMIN", grantId: null },
        "SUPPORT_EMPLOYMENT_" + state,
        userId,
        null,
        context,
        { state: before?.state ?? null },
        { state, requestFingerprint: fingerprint },
      );
      return result;
    });
  }
  async grant(
    actorId: string,
    userId: string,
    capability: SupportCapability,
    facilityId: string | null,
    expiresAt: string | undefined,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const { prior, fingerprint } = await this.supportReplay(
        tx,
        actorId,
        context,
        "SUPPORT_CAPABILITY_GRANTED",
        { userId, capability, facilityId, expiresAt: expiresAt ?? null },
      );
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { supportEmployment: true },
      });
      if (
        !user?.isActive ||
        user.accountStatus !== "ACTIVE" ||
        user.role !== "TECHNICAL_SUPPORT" ||
        user.facilityId !== null ||
        user.supportEmployment?.state !== "ACTIVE" ||
        actorId === userId
      )
        throw new ForbiddenException("Active support employment required.");
      if (
        ["FACILITY_READ", "SERVICE_HEALTH_READ"].includes(capability) !==
        (facilityId === null)
      )
        throw new BadRequestException("Explicit capability scope required.");
      const expiry = expiresAt ? new Date(expiresAt) : null;
      if (
        (sensitive.includes(capability) && !expiry) ||
        (expiry &&
          (!Number.isFinite(expiry.getTime()) ||
            expiry.getTime() <= Date.now()))
      )
        throw new BadRequestException("Future expiry required.");
      if (
        facilityId &&
        !(await tx.facility.findUnique({ where: { id: facilityId } }))?.isActive
      )
        throw new BadRequestException("Active facility required.");
      if (prior)
        return tx.supportCapabilityGrant.findUniqueOrThrow({
          where: { id: prior.resourceId },
        });
      const grant = await tx.supportCapabilityGrant.create({
        data: {
          actorUserId: userId,
          approvedByUserId: actorId,
          capability,
          facilityId,
          expiresAt: expiry,
          reason: context.reason,
        },
      });
      await this.audit(
        tx,
        actorId,
        { actorRole: "ADMIN", authority: "PLATFORM_ADMIN", grantId: null },
        "SUPPORT_CAPABILITY_GRANTED",
        grant.id,
        facilityId,
        context,
        {},
        {
          userId,
          capability,
          expiresAt: expiry?.toISOString() ?? null,
          requestFingerprint: fingerprint,
        },
      );
      return grant;
    });
  }
  async revokeGrant(actorId: string, id: string, context: ActionContext) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const { prior, fingerprint } = await this.supportReplay(
        tx,
        actorId,
        context,
        "SUPPORT_CAPABILITY_REVOKED",
        { id },
      );
      if (prior) return { revoked: true };
      const grant = await tx.supportCapabilityGrant.findUnique({
        where: { id },
      });
      if (!grant) throw new NotFoundException("Grant not found.");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${grant.actorUserId}::uuid FOR UPDATE`;
      await tx.supportCapabilityGrant.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(
        tx,
        actorId,
        { actorRole: "ADMIN", authority: "PLATFORM_ADMIN", grantId: null },
        "SUPPORT_CAPABILITY_REVOKED",
        id,
        grant.facilityId,
        context,
        {},
        { revoked: true, requestFingerprint: fingerprint },
      );
      return { revoked: true };
    });
  }
  async directory(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const authority = await supportAuthority(
        tx,
        actorId,
        "FACILITY_READ",
        null,
      );
      return tx.facility.findMany({
        where:
          authority.actorRole === "ADMIN"
            ? {}
            : {
                isActive: true,
                operationalState: { notIn: ["SUSPENDED", "DECOMMISSIONED"] },
                supportAssignments: {
                  some: { actorUserId: actorId, revokedAt: null },
                },
              },
        select: { id: true, name: true, isActive: true },
        orderBy: { id: "asc" },
        take: 100,
      });
    });
  }
  async recoveryAccounts(actorId: string, cursor?: string) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const rows = await tx.user.findMany({
        where: {
          OR: [{ facilityId: { not: null } }, { role: "TECHNICAL_SUPPORT" }],
          id: { not: actorId, ...(cursor ? { gt: cursor } : {}) },
          role: {
            in: [
              "USER",
              "FACILITY_ADMIN",
              "FACILITY_OPERATOR",
              "TECHNICAL_SUPPORT",
            ],
          },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          accountStatus: true,
          isActive: true,
          membershipState: true,
          facility: { select: { id: true, name: true } },
          supportEmployment: { select: { state: true } },
        },
        orderBy: { id: "asc" },
        take: 101,
      });
      return {
        accounts: rows.slice(0, 100).map(humanAccount),
        nextCursor: rows.length > 100 ? rows[99]!.id : null,
      };
    });
  }
  async firstFacilityAdminEligibility(actorId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      try {
        const authority = await enrollmentAuthority(
          tx,
          actorId,
          facilityId,
          "FACILITY_ADMIN",
        );
        if (authority.provisioningMode !== "FIRST_FACILITY_ADMIN")
          throw new ForbiddenException(
            "Assigned Technical Support commissioning authority required.",
          );
        return {
          eligible: true,
          explanation:
            "Current authority confirmed. Submission and acceptance recheck commissioning, assignment, permission and the absence of an active Facility Administrator.",
        };
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        return { eligible: false, explanation: error.message };
      }
    });
  }
  firstFacilityAdmin(
    actorId: string,
    facilityId: string,
    input: EnrollmentIdentity,
    key: string,
    context: { reason: string; correlationId: string },
  ) {
    requireEnrollmentDeliveryConfiguration();
    // Fixed target role and no Support Case: the canonical writer enforces the
    // commissioning contract inside its mutation transaction and records its mode.
    return this.enrollment.request(
      input,
      key,
      facilityId,
      actorId,
      "FACILITY_ADMIN",
      { reason: context.reason, correlationId: context.correlationId },
      true,
    );
  }
  async invitationRoles(
    actorId: string,
    facilityId: string,
    caseReference?: string,
  ) {
    // Use the write authority checker itself. This is a current advisory projection,
    // never a credential; request and acceptance still revalidate independently.
    return this.prisma.$transaction(async (tx) => {
      const roles: string[] = [];
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { role: true },
      });
      if (actor?.role === "TECHNICAL_SUPPORT" && !caseReference)
        return {
          roles,
          explanation:
            "Use Commissioning to provision the first Facility Administrator. Exceptional staffing requires an assigned Support Case and Temporary Elevation.",
        };
      for (const role of [
        "FACILITY_ADMIN",
        "FACILITY_OPERATOR",
        "USER",
      ] as const) {
        try {
          await enrollmentAuthority(
            tx,
            actorId,
            facilityId,
            role,
            caseReference,
          );
          roles.push(role);
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
        }
      }
      return {
        roles,
        explanation: roles.length
          ? "Enrollment rechecks current authority when submitted."
          : "Current membership or Support employment, assignment, permission, assigned open case and required Temporary Elevation are needed.",
      };
    });
  }
  async members(actorId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      const authority = await institutionalAuthority(
        tx,
        actorId,
        facilityId,
        "STAFF_READ",
      );
      const rows = await tx.user.findMany({
        where: {
          facilityId,
          role: {
            in:
              authority.actorRole === "TECHNICAL_SUPPORT"
                ? ["FACILITY_ADMIN", "FACILITY_OPERATOR"]
                : ["USER", "FACILITY_ADMIN", "FACILITY_OPERATOR"],
          },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          membershipState: true,
          accountStatus: true,
          isActive: true,
        },
        orderBy: { id: "asc" },
        take: 100,
      });
      return rows.map(humanAccount);
    });
  }
  invite(
    actorId: string,
    facilityId: string | undefined,
    role: "USER" | "FACILITY_ADMIN" | "FACILITY_OPERATOR" | "TECHNICAL_SUPPORT",
    input: EnrollmentIdentity,
    key: string,
    auditContext?: ActionContext,
  ) {
    requireEnrollmentDeliveryConfiguration();
    return this.enrollment.request(
      input,
      key,
      facilityId,
      actorId,
      role,
      auditContext,
    );
  }
  async membership(
    actorId: string,
    facilityId: string,
    targetId: string,
    action: "suspend" | "revoke" | "restore" | "recover",
    context: ActionContext,
  ) {
    return this.prisma.$transaction((tx) =>
      changeMembership(tx, actorId, facilityId, targetId, action, context),
    );
  }
  async diagnostics(
    actorId: string,
    facilityId: string,
    kind: "enrollments" | "delivery" | "audit",
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cap =
        kind === "enrollments"
          ? "ENROLLMENT_DIAGNOSTICS"
          : kind === "delivery"
            ? "DELIVERY_DIAGNOSTICS"
            : "AUDIT_READ";
      await institutionalAuthority(tx, actorId, facilityId, cap);
      if (kind === "enrollments")
        return tx.enrollmentRequest.findMany({
          where: { facilityId },
          select: {
            id: true,
            requestedRole: true,
            verifiedAt: true,
            acceptedAt: true,
            revokedAt: true,
            expiresAt: true,
          },
          take: 100,
          orderBy: { createdAt: "desc" },
        });
      if (kind === "delivery")
        return tx.accountInvitationDelivery.findMany({
          // Older enrollment outbox rows omitted the redundant facilityId.
          where: {
            OR: [
              { facilityId },
              { facilityId: null, enrollment: { facilityId } },
            ],
          },
          select: {
            id: true,
            channel: true,
            enrollmentId: true,
            status: true,
            deliveryStatus: true,
            failureCategory: true,
            attemptCount: true,
            providerAcceptedAt: true,
          },
          take: 100,
          orderBy: { queuedAt: "desc" },
        });
      return tx.administrativeAuditEvent.findMany({
        where: { facilityId },
        select: {
          id: true,
          actorUserId: true,
          actorRole: true,
          action: true,
          resourceId: true,
          authorityKind: true,
          authorityGrantId: true,
          createdAt: true,
          correlationId: true,
        },
        take: 100,
        orderBy: { createdAt: "desc" },
      });
    });
  }

  async facilityState(
    actorId: string,
    facilityId: string,
    action: "suspend" | "reactivate",
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR UPDATE`;
      const facility = await tx.facility.findUnique({
        where: { id: facilityId },
      });
      if (!facility) throw new NotFoundException("Facility not found.");
      if (
        action === "reactivate" &&
        !(await tx.user.count({
          where: {
            facilityId,
            role: "FACILITY_ADMIN",
            isActive: true,
            accountStatus: "ACTIVE",
            membershipState: "ACTIVE",
          },
        }))
      )
        throw new ConflictException("Active Facility Admin required.");
      await tx.facility.update({
        where: { id: facilityId },
        data: { isActive: action === "reactivate" },
      });
      if (action === "suspend") {
        const revokedAt = new Date();
        await tx.facilitySupportAssignment.updateMany({
          where: { facilityId, revokedAt: null },
          data: { revokedAt },
        });
        await tx.temporaryElevation.updateMany({
          where: { facilityId, revokedAt: null },
          data: { revokedAt },
        });
      }
      await this.audit(
        tx,
        actorId,
        { actorRole: "ADMIN", authority: "PLATFORM_ADMIN", grantId: null },
        "FACILITY_" + action.toUpperCase(),
        facilityId,
        facilityId,
        context,
        { isActive: facility.isActive },
        { isActive: action === "reactivate" },
      );
      return { id: facilityId, isActive: action === "reactivate" };
    });
  }
  async health(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await supportAuthority(tx, actorId, "SERVICE_HEALTH_READ", null);
      await tx.$queryRaw`SELECT 1`;
      return {
        database: "AVAILABLE",
        delivery: "SEE_SCOPED_DELIVERY_DIAGNOSTICS",
      };
    });
  }
  private async incidentReadAuthority(
    tx: Prisma.TransactionClient,
    actorId: string,
    facilityId: string,
    caseReference?: string,
    requireCase = false,
  ): Promise<Authority> {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId}::uuid FOR SHARE`;
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (requireCase && actor?.role === "TECHNICAL_SUPPORT" && !caseReference)
      throw new ForbiddenException("Select a current assigned Support Case.");
    let authority: Authority = {
      actorRole: "FACILITY_OPERATOR",
      authority: "FACILITY_OPERATOR",
      grantId: null,
    };
    if (!(
      actor?.role === "FACILITY_OPERATOR" &&
      actor.isActive &&
      actor.accountStatus === "ACTIVE" &&
      actor.membershipState === "ACTIVE" &&
      actor.facilityId === facilityId
    ))
      authority = await institutionalAuthority(
        tx,
        actorId,
        facilityId,
        "INCIDENT_SUPPORT_READ",
        caseReference,
      );
    await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR SHARE`;
    const facility = await tx.facility.findUnique({
      where: { id: facilityId },
    });
    if (
      !facility?.isActive ||
      ["SUSPENDED", "DECOMMISSIONED"].includes(facility.operationalState)
    )
      throw new ForbiddenException("Active facility required.");
    return authority;
  }
  async safeWalkEmergencies(
    actorId: string,
    facilityId: string,
    caseReference?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const authority = await this.incidentReadAuthority(
        tx,
        actorId,
        facilityId,
        caseReference,
        true,
      );
      const result = await readSafeWalkEmergencies(tx, facilityId);
      await tx.administrativeAuditEvent.create({
        data: {
          actorUserId: actorId,
          actorRole: authority.actorRole,
          authorityKind: authority.authority,
          authorityGrantId: authority.grantId,
          facilityId,
          resourceId: facilityId,
          action: "SAFEWALK_EMERGENCY_READ",
          caseReference: authority.supportCaseId,
        },
      });
      return result;
    });
  }
  async incidents(actorId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.incidentReadAuthority(tx, actorId, facilityId);
      return tx.incident.findMany({
        where: { facilityId },
        select: {
          id: true,
          status: true,
          trigger: true,
          createdAt: true,
          resolvedAt: true,
        },
        take: 100,
        orderBy: { createdAt: "desc" },
      });
    });
  }
  async commandCenter(actorId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      await institutionalAuthority(
        tx,
        actorId,
        facilityId,
        "COMMAND_CENTER_DIAGNOSTICS",
      );
      const [openIncidents, activeOperators] = await Promise.all([
        tx.incident.count({ where: { facilityId, status: "OPEN" } }),
        tx.user.count({
          where: {
            facilityId,
            role: "FACILITY_OPERATOR",
            isActive: true,
            accountStatus: "ACTIVE",
            membershipState: "ACTIVE",
          },
        }),
      ]);
      return { facilityId, openIncidents, activeOperators };
    });
  }
  async invitationAction(
    actorId: string,
    facilityId: string,
    id: string,
    action: "resend" | "revoke",
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "EnrollmentRequest" WHERE id=${id}::uuid FOR UPDATE`;
      const authority = await institutionalAuthority(
        tx,
        actorId,
        facilityId,
        "ENROLLMENT_RETRY",
        context.caseReference,
      );
      const op = await this.supportReplay(
        tx,
        actorId,
        context,
        "ENROLLMENT_" + action.toUpperCase(),
        { facilityId, id, action },
      );
      const row = await tx.enrollmentRequest.findUnique({
        where: { id },
        include: { deliveries: true },
      });
      if (
        !row ||
        row.facilityId !== facilityId ||
        row.requestedRole === "TECHNICAL_SUPPORT"
      )
        throw new NotFoundException("Enrollment not found.");
      if (op.prior) return { id, action };
      if (action === "resend") requireEnrollmentDeliveryConfiguration();
      await applyEnrollmentDeliveryAction(tx, row, action, true);
      await this.audit(
        tx,
        actorId,
        authority,
        "ENROLLMENT_" + action.toUpperCase(),
        id,
        facilityId,
        context,
        {},
        { action, requestFingerprint: op.fingerprint },
      );
      return { id, action };
    });
  }

  async context(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        include: { supportEmployment: true },
      });
      if (!actor?.isActive || actor.accountStatus !== "ACTIVE")
        throw new ForbiddenException("Current actor required.");
      if (
        actor.role === "TECHNICAL_SUPPORT" &&
        (actor.facilityId !== null ||
          actor.supportEmployment?.state !== "ACTIVE")
      )
        throw new ForbiddenException("Active employment required.");
      let facilities: Array<{
        id: string;
        name: string;
        capabilities: string[];
      }> = [];
      if (actor.role === "ADMIN")
        facilities = (
          await tx.facility.findMany({
            select: { id: true, name: true },
            take: 100,
            orderBy: { id: "asc" },
          })
        ).map((f) => ({ ...f, capabilities: ["PLATFORM_ADMIN"] }));
      else if (actor.role === "TECHNICAL_SUPPORT") {
        const grants = await tx.supportCapabilityGrant.findMany({
          where: {
            actorUserId: actorId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            facility: {
              isActive: true,
              operationalState: { notIn: ["SUSPENDED", "DECOMMISSIONED"] },
              supportAssignments: {
                some: { actorUserId: actorId, revokedAt: null },
              },
            },
          },
          include: { facility: { select: { id: true, name: true } } },
          take: 500,
        });
        const grouped = new Map<
          string,
          { id: string; name: string; capabilities: string[] }
        >();
        for (const g of grants) {
          if (g.facility) {
            const f = grouped.get(g.facility.id) ?? {
              ...g.facility,
              capabilities: [],
            };
            f.capabilities.push(g.capability);
            grouped.set(f.id, f);
          }
        }
        facilities = [...grouped.values()];
      } else if (
        ["FACILITY_ADMIN", "FACILITY_OPERATOR"].includes(actor.role) &&
        actor.facilityId &&
        actor.membershipState === "ACTIVE"
      ) {
        const f = await tx.facility.findUnique({
          where: { id: actor.facilityId },
          select: { id: true, name: true, isActive: true },
        });
        if (f?.isActive)
          if (f)
            facilities = [
              { id: f.id, name: f.name, capabilities: [actor.role] },
            ];
      } else throw new ForbiddenException("Institutional role required.");
      const globalCapabilities =
        actor.role === "TECHNICAL_SUPPORT"
          ? (
              await tx.supportCapabilityGrant.findMany({
                where: {
                  actorUserId: actorId,
                  facilityId: null,
                  revokedAt: null,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
                select: { capability: true },
                take: 100,
              })
            ).map((g) => g.capability)
          : [];
      return {
        actor: {
          id: actorId,
          role: actor.role,
          name: [actor.firstName, actor.lastName].join(" "),
        },
        facilities,
        globalCapabilities,
        elevations:
          actor.role === "TECHNICAL_SUPPORT"
            ? await tx.temporaryElevation.findMany({
                where: {
                  actorUserId: actorId,
                  facilityId: { in: facilities.map((f) => f.id) },
                },
                select: {
                  id: true,
                  facilityId: true,
                  supportCaseId: true,
                  capability: true,
                  startsAt: true,
                  expiresAt: true,
                  revokedAt: true,
                },
                orderBy: { createdAt: "desc" },
                take: 100,
              })
            : [],
      };
    });
  }
}
