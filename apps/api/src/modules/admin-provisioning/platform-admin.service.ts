import { applyEnrollmentDeliveryAction } from "../onboarding/enrollment-delivery-action";
import { changeMembership } from "../onboarding/membership-lifecycle";
import { randomUUID } from "crypto";
import { onboardingAuthority } from "../onboarding/onboarding-authority";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EnrollmentService } from "../auth/enrollment.service";
import { maskedPerson } from "../protected-identity/masked-person";
import type { CreateOperatorDto } from "./dto/create-operator.dto";

const memberSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneNumber: true,
  role: true,
  facilityId: true,
  isActive: true,
  accountStatus: true,
  activatedAt: true,
  invitedByUserId: true,
  createdAt: true,
} as const;
const facilitySelect = {
  id: true,
  name: true,
  type: true,
  isActive: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
} as const;
const invitationSelect = {
  id: true,
  requestedRole: true,
  facilityId: true,
  invitedByUserId: true,
  createdAt: true,
  expiresAt: true,
  verifiedAt: true,
  acceptedAt: true,
  acceptedUserId: true,
  revokedAt: true,
  lastResentAt: true,
  deliveries: {
    select: {
      id: true,
      channel: true,
      status: true,
      attemptCount: true,
      queuedAt: true,
      nextAttemptAt: true,
      lastAttemptAt: true,
      sentAt: true,
      failedAt: true,
    },
  },
} as const;

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollment: EnrollmentService,
  ) {}

  private async authority(tx: Prisma.TransactionClient, actorId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId}::uuid FOR SHARE`;
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (
      !actor?.isActive ||
      actor.accountStatus !== "ACTIVE" ||
      actor.role !== "ADMIN"
    )
      throw new ForbiddenException("Platform authority required.");
  }
  private async facility(tx: Prisma.TransactionClient, id: string) {
    const facility = await tx.facility.findUnique({
      where: { id },
      select: facilitySelect,
    });
    if (!facility) throw new NotFoundException("Facility not found.");
    return facility;
  }
  async directory(actorId: string, cursor?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.authority(tx, actorId);
      const rows = await tx.facility.findMany({
        select: facilitySelect,
        orderBy: { id: "asc" },
        take: 51,
        ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      });
      return {
        facilities: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    });
  }
  async detail(actorId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.authority(tx, actorId);
      return { facility: await this.facility(tx, facilityId) };
    });
  }
  async members(actorId: string, facilityId: string, cursor?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.authority(tx, actorId);
      const facility = await this.facility(tx, facilityId);
      const rows = await tx.user.findMany({
        where: {
          facilityId,
          role: { in: ["USER", "FACILITY_ADMIN", "FACILITY_OPERATOR"] },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: memberSelect,
        orderBy: { id: "asc" },
        take: 51,
      });
      return {
        facility,
        members: rows.slice(0, 50).map((row) => ({
          ...maskedPerson(row),
          membershipState: !row.isActive
            ? "SUSPENDED"
            : row.accountStatus === "ACTIVE"
              ? "ACTIVE"
              : "PENDING_ACTIVATION",
        })),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    });
  }
  invite(
    actorId: string,
    dto: CreateOperatorDto,
    key: string,
    role: "USER" | "FACILITY_ADMIN" | "FACILITY_OPERATOR",
  ) {
    return this.enrollment.request(dto, key, dto.facilityId, actorId, role);
  }
  async invitations(
    actorId: string,
    facilityId: string,
    cursor?: string,
    staffOnly = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (staffOnly) await onboardingAuthority(tx, actorId, facilityId);
      else await this.authority(tx, actorId);
      await this.facility(tx, facilityId);
      const rows = await tx.enrollmentRequest.findMany({
        where: {
          facilityId,
          ...(staffOnly
            ? {
                requestedRole: {
                  in: ["FACILITY_ADMIN", "FACILITY_OPERATOR"] as Array<
                    "FACILITY_ADMIN" | "FACILITY_OPERATOR"
                  >,
                },
              }
            : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: invitationSelect,
        orderBy: { id: "asc" },
        take: 51,
      });
      return {
        invitations: rows.slice(0, 50).map((row) => ({
          ...row,
          status: row.revokedAt
            ? "REVOKED"
            : row.acceptedAt
              ? "ACCEPTED"
              : row.expiresAt <= new Date()
                ? "EXPIRED"
                : row.verifiedAt
                  ? "ACCEPTANCE_PENDING"
                  : "VERIFICATION_PENDING",
        })),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    });
  }
  async invitationAction(
    actorId: string,
    facilityId: string,
    id: string,
    action: "resend" | "revoke",
    reason: string,
    staffOnly = false,
  ) {
    this.reason(reason);
    return this.prisma.$transaction(async (tx) => {
      // Same lock order as verification and worker claiming.
      await tx.$queryRaw`SELECT id FROM "EnrollmentRequest" WHERE id = ${id}::uuid FOR UPDATE`;
      const authority = staffOnly
        ? await onboardingAuthority(tx, actorId, facilityId)
        : (await this.authority(tx, actorId), undefined);
      const row = await tx.enrollmentRequest.findUnique({
        where: { id },
        include: { deliveries: true },
      });
      if (
        !row ||
        row.facilityId !== facilityId ||
        (staffOnly &&
          !["FACILITY_ADMIN", "FACILITY_OPERATOR"].includes(row.requestedRole))
      )
        throw new NotFoundException("Invitation not found.");
      const facilityActive =
        action === "resend"
          ? (await this.facility(tx, facilityId)).isActive
          : true;
      await applyEnrollmentDeliveryAction(tx, row, action, facilityActive);
      await tx.administrativeAuditEvent.create({
        data: {
          actorUserId: actorId,
          actorRole: authority?.actorRole ?? "ADMIN",
          action:
            action === "resend" ? "INVITATION_RESENT" : "INVITATION_REVOKED",
          resourceId: id,
          facilityId,
          reason,
          beforeState: {
            revoked: false,
            expiresAt: row.expiresAt.toISOString(),
          },
          afterState: { action, ...(authority ?? {}) },
        },
      });
      return {
        requestId: id,
        status: action === "resend" ? "VERIFICATION_PENDING" : "REVOKED",
      };
    });
  }
  private reason(reason: string) {
    if (!reason?.trim() || reason.trim().length > 500)
      throw new BadRequestException(
        "An administrative reason of 1–500 characters is required.",
      );
  }
  async membershipAction(
    actorId: string,
    facilityId: string,
    userId: string,
    action: "suspend" | "reactivate" | "revoke",
    reason: string,
  ) {
    this.reason(reason);
    // ADMIN revalidation and mutation share the same transaction and locks.
    return this.prisma.$transaction((tx) =>
      changeMembership(
        tx,
        actorId,
        facilityId,
        userId,
        action === "reactivate" ? "restore" : action,
        { reason, caseReference: randomUUID(), correlationId: randomUUID() },
        true,
      ),
    );
  }
  async audit(actorId: string, facilityId: string, cursor?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.authority(tx, actorId);
      await this.facility(tx, facilityId);
      const rows = await tx.administrativeAuditEvent.findMany({
        where: {
          OR: [{ facilityId }, { previousFacilityId: facilityId }],
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 51,
      });
      return {
        events: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    });
  }
}
