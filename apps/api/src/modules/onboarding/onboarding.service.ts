import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EnrollmentService } from "../auth/enrollment.service";
import { PlatformAdminService } from "../admin-provisioning/platform-admin.service";
import type { CreateOperatorDto } from "../admin-provisioning/dto/create-operator.dto";
import { platformAuthority } from "./onboarding-authority";

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollment: EnrollmentService,
    private readonly platform: PlatformAdminService,
  ) {}

  private reason(value: string) {
    if (!value?.trim() || value.trim().length > 500)
      throw new BadRequestException(
        "A reason of 1–500 characters is required.",
      );
    return value.trim();
  }
  async employees(actorId: string, cursor?: string) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      // Opaque user references only: this is not a protected-identity lookup.
      const rows = await tx.user.findMany({
        where: { ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, role: true, isActive: true, accountStatus: true },
        orderBy: { id: "asc" },
        take: 51,
      });
      return {
        users: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    });
  }
  async grants(actorId: string, employeeId: string, cursor?: string) {
    return this.prisma.$transaction(async (tx) => {
      await platformAuthority(tx, actorId);
      const rows = await tx.onboardingAuthorityGrant.findMany({
        where: {
          actorUserId: employeeId,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 51,
      });
      return {
        grants: rows.slice(0, 50).map((g) => ({
          ...g,
          status: g.revokedAt
            ? "REVOKED"
            : g.expiresAt <= new Date()
              ? "EXPIRED"
              : "ACTIVE",
        })),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    });
  }
  async grant(
    actorId: string,
    employeeId: string,
    facilityId: string,
    expiresAt: string,
    reason: string,
  ) {
    reason = this.reason(reason);
    const expiry = new Date(expiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry <= new Date())
      throw new BadRequestException("A future expiration is required.");
    if (actorId === employeeId)
      throw new BadRequestException("Self delegation is not permitted.");
    return this.prisma.$transaction(async (tx) => {
      // Consistent user-id order also covers reciprocal administrative operations.
      for (const id of [actorId, employeeId].sort())
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id}::uuid FOR UPDATE`;
      await platformAuthority(tx, actorId);
      const employee = await tx.user.findUnique({ where: { id: employeeId } });
      if (
        !employee?.isActive ||
        employee.accountStatus !== "ACTIVE" ||
        employee.role === "ADMIN"
      )
        throw new BadRequestException(
          "Select an active non-ADMIN employee account.",
        );
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id = ${facilityId}::uuid FOR SHARE`;
      const facility = await tx.facility.findUnique({
        where: { id: facilityId },
      });
      if (!facility?.isActive)
        throw new BadRequestException("Active facility required.");
      if (expiry <= new Date())
        throw new BadRequestException("A future expiration is required.");
      const duplicate = await tx.onboardingAuthorityGrant.findFirst({
        where: {
          actorUserId: employeeId,
          facilityId,
          permission: "STAFF_ONBOARDING",
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (duplicate)
        throw new ConflictException(
          "An active grant already exists. Revoke it before replacing it.",
        );
      const grant = await tx.onboardingAuthorityGrant.create({
        data: {
          actorUserId: employeeId,
          approvedByUserId: actorId,
          facilityId,
          expiresAt: expiry,
        },
      });
      await tx.administrativeAuditEvent.create({
        data: {
          actorUserId: actorId,
          actorRole: "ADMIN",
          action: "ONBOARDING_AUTHORITY_GRANTED",
          resourceId: grant.id,
          facilityId,
          reason,
          afterState: {
            actorUserId: employeeId,
            grantId: grant.id,
            approvedByUserId: actorId,
            permission: grant.permission,
            expiresAt: expiry.toISOString(),
          },
        },
      });
      return grant;
    });
  }
  async revoke(
    actorId: string,
    employeeId: string,
    reason: string,
    grantId?: string,
  ) {
    reason = this.reason(reason);
    if (actorId === employeeId)
      throw new BadRequestException("Select another employee.");
    return this.prisma.$transaction(async (tx) => {
      for (const id of [actorId, employeeId].sort())
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id}::uuid FOR UPDATE`;
      await platformAuthority(tx, actorId);
      if (
        grantId &&
        !(await tx.onboardingAuthorityGrant.findFirst({
          where: { id: grantId, actorUserId: employeeId },
        }))
      )
        throw new NotFoundException("Grant not found.");
      const where = {
        actorUserId: employeeId,
        revokedAt: null,
        ...(grantId ? { id: grantId } : {}),
      };
      const rows = await tx.onboardingAuthorityGrant.findMany({ where });
      const now = new Date();
      await tx.onboardingAuthorityGrant.updateMany({
        where,
        data: { revokedAt: now },
      });
      for (const grant of rows)
        await this.revocationAudit(tx, actorId, grant, reason, now);
      if (!grantId)
        await tx.administrativeAuditEvent.create({
          data: {
            actorUserId: actorId,
            actorRole: "ADMIN",
            action: "ONBOARDING_AUTHORITY_REVOKED_ALL",
            resourceId: employeeId,
            reason,
            beforeState: { unrevokedGrants: rows.length },
            afterState: { unrevokedGrants: 0 },
          },
        });
      return { revokedCount: rows.length };
    });
  }
  private async revocationAudit(
    tx: Prisma.TransactionClient,
    actorId: string,
    grant: {
      id: string;
      actorUserId: string;
      facilityId: string;
      approvedByUserId: string;
    },
    reason: string,
    now: Date,
  ) {
    await tx.administrativeAuditEvent.create({
      data: {
        actorUserId: actorId,
        actorRole: "ADMIN",
        action: "ONBOARDING_AUTHORITY_REVOKED",
        resourceId: grant.id,
        facilityId: grant.facilityId,
        reason,
        beforeState: {
          revokedAt: null,
          actorUserId: grant.actorUserId,
          approvedByUserId: grant.approvedByUserId,
        },
        afterState: { revokedAt: now.toISOString(), grantId: grant.id },
      },
    });
  }
  async facilities(actorId: string, cursor?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId}::uuid FOR SHARE`;
      const actor = await tx.user.findUnique({ where: { id: actorId } });
      if (!actor?.isActive || actor.accountStatus !== "ACTIVE")
        throw new ForbiddenException("Onboarding authority required.");
      const rows = await tx.facility.findMany({
        where: {
          isActive: true,
          ...(cursor ? { id: { gt: cursor } } : {}),
          ...(actor.role === "ADMIN"
            ? {}
            : {
                onboardingGrants: {
                  some: {
                    actorUserId: actorId,
                    permission: "STAFF_ONBOARDING",
                    revokedAt: null,
                    expiresAt: { gt: new Date() },
                  },
                },
              }),
        },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
        take: 51,
      });
      return {
        facilities: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    });
  }
  invite(
    actorId: string,
    dto: CreateOperatorDto,
    key: string,
    role: "FACILITY_ADMIN" | "FACILITY_OPERATOR",
  ) {
    if (!["FACILITY_ADMIN", "FACILITY_OPERATOR"].includes(role))
      throw new ForbiddenException("Staff onboarding only.");
    return this.enrollment.request(dto, key, dto.facilityId, actorId, role);
  }
  invitations(actorId: string, facilityId: string, cursor?: string) {
    return this.platform.invitations(actorId, facilityId, cursor, true);
  }
  invitationAction(
    actorId: string,
    facilityId: string,
    id: string,
    action: "resend" | "revoke",
    reason: string,
  ) {
    return this.platform.invitationAction(
      actorId,
      facilityId,
      id,
      action,
      reason,
      true,
    );
  }
}
