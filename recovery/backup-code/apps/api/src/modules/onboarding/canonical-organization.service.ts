import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  Prisma,
  type FacilityOperationalState,
  type SupportCapability,
  type SupportCaseStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { platformAuthority } from "./onboarding-authority";
import {
  institutionalAuthority,
  supportAuthority,
  type Authority,
} from "./support-authority";
import type { ActionContext } from "./membership-lifecycle";
import {
  COMMISSIONING_GATES,
  TRAINING_GATES,
  STANDARD_SUPPORT_PERMISSIONS,
  commissioningReadiness,
} from "./commissioning-policy";
const PLATFORM: Authority = {
  actorRole: "ADMIN",
  authority: "PLATFORM_ADMIN",
  grantId: null,
};
@Injectable()
export class CanonicalOrganizationService {
  constructor(private readonly prisma: PrismaService) {}
  private async operation(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    body: unknown,
    context: ActionContext,
  ) {
    if (!context.reason?.trim() || context.reason.length > 500)
      throw new BadRequestException(
        "A reason of 1–500 characters is required.",
      );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId + ":canonical:" + context.correlationId}))`;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([action, body, context]))
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
        "Operation identity already belongs to a different request.",
      );
    return { prior, fingerprint };
  }
  private audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    authority: Authority,
    action: string,
    id: string,
    facilityId: string | null,
    context: ActionContext,
    fingerprint: string,
    before: Prisma.InputJsonValue,
    after: Prisma.InputJsonValue,
  ) {
    return tx.administrativeAuditEvent.create({
      data: {
        actorUserId: actorId,
        actorRole: authority.actorRole,
        authorityKind: authority.authority,
        authorityGrantId: authority.grantId,
        action,
        resourceId: id,
        facilityId,
        reason: context.reason,
        caseReference: context.caseReference,
        correlationId: context.correlationId,
        beforeState: before,
        afterState: {
          result: after,
          requestFingerprint: fingerprint,
          authority: { ...authority },
        },
      },
    });
  }
  async receipt(actorId: string, correlationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId + ":canonical:" + correlationId}))`;
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        include: { supportEmployment: true },
      });
      if (
        !actor?.isActive ||
        actor.accountStatus !== "ACTIVE" ||
        (actor.role === "TECHNICAL_SUPPORT" &&
          actor.supportEmployment?.state !== "ACTIVE")
      )
        throw new ForbiddenException("Current authority required.");
      const receipt = await tx.administrativeAuditEvent.findFirst({
        where: { actorUserId: actorId, correlationId },
        select: {
          id: true,
          action: true,
          resourceId: true,
          facilityId: true,
          createdAt: true,
        },
      });
      if (receipt?.facilityId)
        await institutionalAuthority(
          tx,
          actorId,
          receipt.facilityId,
          "STAFF_READ",
        );
      return {
        status: receipt ? "COMMITTED" : "NOT_RECORDED",
        correlationId,
        receipt,
      };
    });
  }
  async responsePolicy(
    actorId: string,
    facilityId: string,
    input: {
      acknowledgementSeconds: number;
      dispatchSeconds: number;
      progressSeconds: number;
      unattendedSeconds: number;
      closureSeconds: number;
    },
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const authority = await institutionalAuthority(
        tx,
        actorId,
        facilityId,
        "STAFF_PROVISION",
        context.caseReference,
      );
      const op = await this.operation(
        tx,
        actorId,
        "FACILITY_RESPONSE_POLICY_CHANGED",
        { facilityId, ...input },
        context,
      );
      if (op.prior) return { id: facilityId };
      if (
        Object.values(input).some(
          (v) => !Number.isInteger(v) || v < 1 || v > 604800,
        ) ||
        input.unattendedSeconds < input.acknowledgementSeconds ||
        input.closureSeconds < input.unattendedSeconds
      )
        throw new BadRequestException(
          "Policy intervals must be whole seconds, between 1 and 604800, with unattended and closure thresholds in order.",
        );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(14, hashtext(${facilityId}))`;
      const before = await tx.facilityResponsePolicy.findUnique({
        where: { facilityId },
      });
      const row = await tx.facilityResponsePolicy.upsert({
        where: { facilityId },
        create: { facilityId, ...input, updatedByUserId: actorId },
        update: {
          ...input,
          version: { increment: 1 },
          updatedByUserId: actorId,
        },
      });
      await this.audit(
        tx,
        actorId,
        authority,
        "FACILITY_RESPONSE_POLICY_CHANGED",
        facilityId,
        facilityId,
        context,
        op.fingerprint,
        { version: before?.version ?? null },
        { ...input, version: row.version },
      );
      return { id: facilityId, version: row.version };
    });
  }
  async overview(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const [
        organizations,
        facilities,
        assignments,
        elevations,
        employmentCount,
        openIncidents,
      ] = await Promise.all([
        tx.organization.findMany({ orderBy: { name: "asc" }, take: 100 }),
        tx.facility.findMany({
          select: {
            id: true,
            name: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
            type: true,
            operationalState: true,
            isActive: true,
          },
          orderBy: { name: "asc" },
          take: 100,
        }),
        tx.facilitySupportAssignment.findMany({
          where: { revokedAt: null },
          select: {
            id: true,
            facilityId: true,
            actorUserId: true,
            assignedByUserId: true,
            createdAt: true,
          },
          take: 100,
        }),
        tx.temporaryElevation.findMany({
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: {
            id: true,
            actorUserId: true,
            facilityId: true,
            supportCaseId: true,
            capability: true,
            expiresAt: true,
          },
          take: 100,
        }),
        tx.supportEmployment.count({ where: { state: "ACTIVE" } }),
        tx.incident.count({ where: { status: "OPEN" } }),
      ]);
      return {
        actor: { id: actorId, role: "ADMIN" },
        organizations,
        facilities,
        assignments,
        elevations,
        employmentCount,
        openIncidents,
        limit: 100,
      };
    });
  }
  async organizations(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      return tx.organization.findMany({ orderBy: { name: "asc" }, take: 100 });
    });
  }
  async createOrganization(
    actorId: string,
    name: string,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      if (!name.trim() || name.trim().length > 160)
        throw new BadRequestException("Organization name required.");
      const op = await this.operation(
        tx,
        actorId,
        "ORGANIZATION_CREATED",
        { name: name.trim() },
        context,
      );
      if (op.prior) return { id: op.prior.resourceId };
      const row = await tx.organization.create({
        data: { name: name.trim(), createdByUserId: actorId },
      });
      await this.audit(
        tx,
        actorId,
        PLATFORM,
        "ORGANIZATION_CREATED",
        row.id,
        null,
        context,
        op.fingerprint,
        {},
        { name: row.name },
      );
      return row;
    });
  }
  async associate(
    actorId: string,
    facilityId: string,
    organizationId: string,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const op = await this.operation(
        tx,
        actorId,
        "FACILITY_ORGANIZATION_CHANGED",
        { facilityId, organizationId },
        context,
      );
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR UPDATE`;
      const facility = await tx.facility.findUniqueOrThrow({
        where: { id: facilityId },
      });
      if (op.prior) return { id: facilityId };
      if (
        !(await tx.organization.findUnique({ where: { id: organizationId } }))
      )
        throw new NotFoundException("Organization not found.");
      if (facility.organizationId && facility.organizationId !== organizationId)
        throw new ConflictException(
          "Organization transfer requires a separately reviewed recovery workflow.",
        );
      await tx.facility.update({
        where: { id: facilityId },
        data: { organizationId },
      });
      await this.audit(
        tx,
        actorId,
        PLATFORM,
        "FACILITY_ORGANIZATION_CHANGED",
        facilityId,
        facilityId,
        context,
        op.fingerprint,
        { organizationId: facility.organizationId },
        { organizationId },
      );
      return { id: facilityId };
    });
  }
  async assign(
    actorId: string,
    facilityId: string,
    supportId: string | null,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const op = await this.operation(
        tx,
        actorId,
        "SUPPORT_ASSIGNMENT_CHANGED",
        { facilityId, supportId },
        context,
      );
      // Employment writers serialize on the recipient. Facility lock serializes owners.
      if (supportId)
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${supportId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR UPDATE`;
      const facility = await tx.facility.findUnique({
        where: { id: facilityId },
      });
      if (!facility) throw new NotFoundException("Facility not found.");
      if (op.prior) return { id: op.prior.resourceId };
      if (supportId) {
        const user = await tx.user.findUnique({
          where: { id: supportId },
          include: { supportEmployment: true },
        });
        if (
          !user?.isActive ||
          user.accountStatus !== "ACTIVE" ||
          user.role !== "TECHNICAL_SUPPORT" ||
          user.facilityId !== null ||
          user.supportEmployment?.state !== "ACTIVE" ||
          supportId === actorId
        )
          throw new ForbiddenException(
            "Active OPA Technical Support employee required.",
          );
        if (
          !facility.isActive ||
          ["SUSPENDED", "DECOMMISSIONED"].includes(facility.operationalState)
        )
          throw new ConflictException("Eligible facility required.");
      }
      const previous = await tx.facilitySupportAssignment.findFirst({
        where: { facilityId, revokedAt: null },
      });
      await tx.facilitySupportAssignment.updateMany({
        where: { facilityId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.temporaryElevation.updateMany({
        where: { facilityId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const row = supportId
        ? await tx.facilitySupportAssignment.create({
            data: {
              facilityId,
              actorUserId: supportId,
              assignedByUserId: actorId,
              reason: context.reason,
            },
          })
        : null;
      // Open cases retain their history; an explicit handoff changes current responsibility.
      if (supportId)
        await tx.supportCase.updateMany({
          where: { facilityId, status: { in: ["OPEN", "INVESTIGATING"] } },
          data: { assignedToUserId: supportId },
        });
      await this.audit(
        tx,
        actorId,
        PLATFORM,
        "SUPPORT_ASSIGNMENT_CHANGED",
        row?.id ?? facilityId,
        facilityId,
        context,
        op.fingerprint,
        {
          previousAssignmentId: previous?.id ?? null,
          previousOwner: previous?.actorUserId ?? null,
        },
        { assignmentId: row?.id ?? null, owner: supportId },
      );
      return { id: row?.id ?? facilityId };
    });
  }
  async profile(
    actorId: string,
    supportId: string,
    facilityId: string,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const op = await this.operation(
        tx,
        actorId,
        "SUPPORT_PROFILE_GRANTED",
        { supportId, facilityId, profile: "STANDARD_FACILITY_SUPPORT" },
        context,
      );
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${supportId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: supportId },
        include: { supportEmployment: true },
      });
      if (
        !user?.isActive ||
        user.accountStatus !== "ACTIVE" ||
        user.role !== "TECHNICAL_SUPPORT" ||
        user.facilityId !== null ||
        user.supportEmployment?.state !== "ACTIVE" ||
        supportId === actorId
      )
        throw new ForbiddenException("Active support employment required.");
      if (op.prior) return { id: supportId };
      for (const capability of STANDARD_SUPPORT_PERMISSIONS)
        await tx.supportCapabilityGrant.create({
          data: {
            actorUserId: supportId,
            approvedByUserId: actorId,
            facilityId,
            capability,
            reason: context.reason,
          },
        });
      // Existing global permission means enumeration, never cross-facility access.
      for (const capability of [
        "FACILITY_READ",
        "SERVICE_HEALTH_READ",
      ] as const)
        await tx.supportCapabilityGrant.create({
          data: {
            actorUserId: supportId,
            approvedByUserId: actorId,
            capability,
            reason: context.reason,
          },
        });
      await this.audit(
        tx,
        actorId,
        PLATFORM,
        "SUPPORT_PROFILE_GRANTED",
        supportId,
        facilityId,
        context,
        op.fingerprint,
        {},
        {
          profile: "STANDARD_FACILITY_SUPPORT",
          capabilities: [...STANDARD_SUPPORT_PERMISSIONS],
        },
      );
      return { id: supportId };
    });
  }
  async cases(actorId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      await institutionalAuthority(tx, actorId, facilityId, "STAFF_READ");
      const rows = await tx.supportCase.findMany({
        where: { facilityId },
        orderBy: { sequence: "desc" },
        take: 100,
      });
      return rows.map((row) => ({
        ...row,
        reference:
          "OPA-" +
          row.createdAt.getUTCFullYear() +
          "-" +
          String(row.sequence).padStart(4, "0"),
      }));
    });
  }
  async createCase(
    actorId: string,
    facilityId: string,
    input: { category: string; summary: string; priority: string },
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const authority = await institutionalAuthority(
        tx,
        actorId,
        facilityId,
        "STAFF_READ",
      );
      const op = await this.operation(
        tx,
        actorId,
        "SUPPORT_CASE_OPENED",
        { facilityId, ...input },
        context,
      );
      if (op.prior) return { id: op.prior.resourceId };
      const assignment = await tx.facilitySupportAssignment.findFirst({
        where: {
          facilityId,
          revokedAt: null,
          actor: {
            isActive: true,
            accountStatus: "ACTIVE",
            supportEmployment: { state: "ACTIVE" },
          },
        },
      });
      if (!assignment)
        throw new ConflictException(
          "Super Admin must assign an active OPA Support owner first.",
        );
      const row = await tx.supportCase.create({
        data: {
          ...input,
          facilityId,
          reportedByUserId: actorId,
          assignedToUserId: assignment.actorUserId,
        },
      });
      await this.audit(
        tx,
        actorId,
        authority,
        "SUPPORT_CASE_OPENED",
        row.id,
        facilityId,
        { ...context, caseReference: row.id },
        op.fingerprint,
        {},
        { status: row.status, assignedToUserId: row.assignedToUserId },
      );
      return row;
    });
  }
  async caseState(
    actorId: string,
    facilityId: string,
    id: string,
    status: SupportCaseStatus,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const authority = await institutionalAuthority(
        tx,
        actorId,
        facilityId,
        "STAFF_READ",
      );
      const op = await this.operation(
        tx,
        actorId,
        "SUPPORT_CASE_CHANGED",
        { facilityId, id, status },
        context,
      );
      if (op.prior) return { id };
      await tx.$queryRaw`SELECT id FROM "SupportCase" WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.supportCase.findFirst({ where: { id, facilityId } });
      if (
        !row ||
        (authority.actorRole === "TECHNICAL_SUPPORT" &&
          row.assignedToUserId !== actorId)
      )
        throw new NotFoundException("Support Case not available.");
      if (row.status === "CLOSED")
        throw new ConflictException(
          "Closed cases remain historical; open a new case.",
        );
      await tx.supportCase.update({ where: { id }, data: { status } });
      if (["RESOLVED", "CLOSED"].includes(status))
        await tx.temporaryElevation.updateMany({
          where: { supportCaseId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await this.audit(
        tx,
        actorId,
        authority,
        "SUPPORT_CASE_CHANGED",
        id,
        facilityId,
        { ...context, caseReference: id },
        op.fingerprint,
        { status: row.status },
        { status },
      );
      return { id, status };
    });
  }
  async elevate(
    actorId: string,
    supportId: string,
    facilityId: string,
    capability: SupportCapability,
    startsAt: Date,
    expiresAt: Date,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const op = await this.operation(
        tx,
        actorId,
        "TEMPORARY_ELEVATION_APPROVED",
        { supportId, facilityId, capability, startsAt, expiresAt },
        context,
      );
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${supportId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: supportId },
        include: { supportEmployment: true },
      });
      if (
        !user?.isActive ||
        user.accountStatus !== "ACTIVE" ||
        user.role !== "TECHNICAL_SUPPORT" ||
        user.facilityId !== null ||
        user.supportEmployment?.state !== "ACTIVE" ||
        actorId === supportId
      )
        throw new ForbiddenException("Active support employment required.");
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR SHARE`;
      const assignment = await tx.facilitySupportAssignment.findFirst({
        where: { actorUserId: supportId, facilityId, revokedAt: null },
      });
      const supportCase = await tx.supportCase.findFirst({
        where: {
          id: context.caseReference,
          facilityId,
          assignedToUserId: supportId,
          status: { in: ["OPEN", "INVESTIGATING"] },
        },
      });
      if (!assignment || !supportCase)
        throw new ForbiddenException(
          "Exact assignment and open Support Case required.",
        );
      if (op.prior) return { id: op.prior.resourceId };
      if (
        !Number.isFinite(startsAt.getTime()) ||
        !Number.isFinite(expiresAt.getTime()) ||
        expiresAt <= startsAt ||
        expiresAt.getTime() <= Date.now()
      )
        throw new BadRequestException("Future expiry after start required.");
      const row = await tx.temporaryElevation.create({
        data: {
          actorUserId: supportId,
          facilityId,
          supportCaseId: supportCase.id,
          capability,
          approvedByUserId: actorId,
          reason: context.reason,
          startsAt,
          expiresAt,
        },
      });
      await this.audit(
        tx,
        actorId,
        PLATFORM,
        "TEMPORARY_ELEVATION_APPROVED",
        row.id,
        facilityId,
        context,
        op.fingerprint,
        {},
        {
          supportId,
          capability,
          startsAt: startsAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      );
      return row;
    });
  }
  async revokeElevation(actorId: string, id: string, context: ActionContext) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const op = await this.operation(
        tx,
        actorId,
        "TEMPORARY_ELEVATION_REVOKED",
        { id },
        context,
      );
      const row = await tx.temporaryElevation.findUnique({ where: { id } });
      if (!row) throw new NotFoundException("Elevation not found.");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${row.actorUserId}::uuid FOR UPDATE`;
      if (!op.prior) {
        await tx.temporaryElevation.updateMany({
          where: { id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit(
          tx,
          actorId,
          PLATFORM,
          "TEMPORARY_ELEVATION_REVOKED",
          id,
          row.facilityId,
          context,
          op.fingerprint,
          {},
          { revoked: true },
        );
      }
      return { id, revoked: true };
    });
  }
  async commissioning(actorId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      await institutionalAuthority(tx, actorId, facilityId, "STAFF_READ");
      const facility = await tx.facility.findUniqueOrThrow({
        where: { id: facilityId },
        include: {
          organization: true,
          supportAssignments: {
            where: { revokedAt: null },
            select: { id: true, actorUserId: true },
          },
        },
      });
      const evidence = await tx.commissioningEvidence.findMany({
        where: { facilityId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 500,
      });
      const activeAdmin =
        (await tx.user.count({
          where: {
            facilityId,
            role: "FACILITY_ADMIN",
            isActive: true,
            accountStatus: "ACTIVE",
            membershipState: "ACTIVE",
          },
        })) > 0;
      return {
        facility,
        evidence,
        gates: COMMISSIONING_GATES,
        trainingGates: TRAINING_GATES,
        readiness: commissioningReadiness(evidence, {
          organization: Boolean(facility.organizationId),
          activeAdmin,
        }),
      };
    });
  }
  async recordEvidence(
    actorId: string,
    facilityId: string,
    input: {
      gate: string;
      passed: boolean;
      evidence: string;
      facilityAdminUserId?: string;
    },
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const authority = await supportAuthority(
        tx,
        actorId,
        "STAFF_PROVISION",
        facilityId,
        context.caseReference,
      );
      const op = await this.operation(
        tx,
        actorId,
        "COMMISSIONING_EVIDENCE_RECORDED",
        { facilityId, ...input },
        context,
      );
      if (op.prior) return { id: op.prior.resourceId };
      if (
        ![...COMMISSIONING_GATES, ...TRAINING_GATES].includes(
          input.gate as (typeof COMMISSIONING_GATES)[number],
        )
      )
        throw new BadRequestException("Unknown commissioning gate.");
      if (!input.evidence.trim())
        throw new BadRequestException(
          "Record observed evidence; a checkbox alone is insufficient.",
        );
      if (input.gate.startsWith("TRAINING_") && !input.facilityAdminUserId)
        throw new BadRequestException(
          "Select the Facility Admin who completed the training.",
        );
      if (
        input.facilityAdminUserId &&
        !(await tx.user.findFirst({
          where: {
            id: input.facilityAdminUserId,
            facilityId,
            role: "FACILITY_ADMIN",
            isActive: true,
            accountStatus: "ACTIVE",
            membershipState: "ACTIVE",
          },
        }))
      )
        throw new BadRequestException(
          "Current facility administrator required.",
        );
      if (
        input.passed &&
        input.gate === "CONFIGURATION" &&
        !(await tx.facilityResponsePolicy.findUnique({ where: { facilityId } }))
      )
        throw new BadRequestException(
          "Configure the facility response policy before recording configuration readiness.",
        );
      const row = await tx.commissioningEvidence.create({
        data: {
          ...input,
          facilityId,
          supportCaseId: context.caseReference,
          recordedByUserId: actorId,
        },
      });
      await this.audit(
        tx,
        actorId,
        authority,
        "COMMISSIONING_EVIDENCE_RECORDED",
        row.id,
        facilityId,
        context,
        op.fingerprint,
        {},
        {
          gate: row.gate,
          passed: row.passed,
          facilityAdminUserId: row.facilityAdminUserId,
        },
      );
      return row;
    });
  }
  async lifecycle(
    actorId: string,
    facilityId: string,
    state: FacilityOperationalState,
    context: ActionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR UPDATE`;
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { role: true },
      });
      const authority =
        actor?.role === "ADMIN"
          ? (await platformAuthority(tx, actorId), PLATFORM)
          : await supportAuthority(
              tx,
              actorId,
              "STAFF_PROVISION",
              facilityId,
              context.caseReference,
            );
      if (
        authority.actorRole !== "ADMIN" &&
        !["COMMISSIONING", "OPERATIONAL"].includes(state)
      )
        throw new ForbiddenException(
          "Only Super Admin changes facility lifecycle outside commissioning.",
        );
      const op = await this.operation(
        tx,
        actorId,
        "FACILITY_LIFECYCLE_CHANGED",
        { facilityId, state },
        context,
      );
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR UPDATE`;
      const facility = await tx.facility.findUniqueOrThrow({
        where: { id: facilityId },
      });
      if (op.prior) return { id: facilityId };
      if (facility.operationalState === "DECOMMISSIONED")
        throw new ConflictException(
          "Decommissioned facilities require separately reviewed platform recovery.",
        );
      if (state === "CREATED")
        throw new BadRequestException(
          "A facility cannot return to its initial creation state.",
        );
      if (state === "OPERATIONAL") {
        const evidence = await tx.commissioningEvidence.findMany({
          where: { facilityId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        const activeAdmin =
          (await tx.user.count({
            where: {
              facilityId,
              role: "FACILITY_ADMIN",
              isActive: true,
              accountStatus: "ACTIVE",
              membershipState: "ACTIVE",
            },
          })) > 0;
        if (
          !commissioningReadiness(evidence, {
            organization: Boolean(facility.organizationId),
            activeAdmin,
          }).ready
        )
          throw new ConflictException(
            "Required commissioning evidence and an active Facility Admin are missing.",
          );
      }
      const active = !["SUSPENDED", "DECOMMISSIONED"].includes(state);
      await tx.facility.update({
        where: { id: facilityId },
        data: { operationalState: state, isActive: active },
      });
      if (!active) {
        await tx.facilitySupportAssignment.updateMany({
          where: { facilityId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.temporaryElevation.updateMany({
          where: { facilityId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit(
        tx,
        actorId,
        authority,
        "FACILITY_LIFECYCLE_CHANGED",
        facilityId,
        facilityId,
        context,
        op.fingerprint,
        { state: facility.operationalState },
        { state },
      );
      return { id: facilityId, state };
    });
  }
}
