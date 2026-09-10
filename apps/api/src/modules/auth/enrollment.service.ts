import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type EnrollmentRequest } from "@prisma/client";
import { randomBytes, timingSafeEqual } from "crypto";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveEnrollmentIdentity } from "../../shared/security/enrollment-resolution";
import {
  enrollmentDigest,
  protectIdentity,
} from "../../shared/security/enrollment-identity";
import {
  hashActivationCredential,
  normalizeActivationCredential,
} from "../../shared/security/activation-code";
import { toE164 } from "../../shared/phone/normalize-phone-number";
import type {
  VerifyEnrollmentDto,
  AcceptEnrollmentDto,
} from "./dto/verify-enrollment.dto";

export type EnrollmentIdentity = {
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
};
const FAILURE = "Enrollment could not be completed.";
const hash = (value: string) =>
  hashActivationCredential(normalizeActivationCredential(value));
const matches = (raw: string, digest: string | null) =>
  digest !== null &&
  timingSafeEqual(Buffer.from(hash(raw), "hex"), Buffer.from(digest, "hex"));

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async request(
    input: EnrollmentIdentity,
    idempotencyKey: string,
    facilityId?: string,
    actorId?: string,
    requestedRole: "USER" | "FACILITY_ADMIN" | "FACILITY_OPERATOR" = "USER",
  ) {
    if (requestedRole !== "USER" && (!facilityId || !actorId))
      throw new ForbiddenException("Platform authority required.");
    const identity = {
      email: input.email.trim().toLowerCase(),
      phoneNumber: toE164(input.phoneNumber),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
    };
    if (!idempotencyKey || idempotencyKey.length > 160)
      throw new BadRequestException("A request idempotency key is required.");
    // No lookup of submitted identifiers in User occurs before ownership verification.
    const digest = enrollmentDigest(
      this.config,
      JSON.stringify([
        facilityId ?? null,
        actorId ?? null,
        identity,
        requestedRole,
        idempotencyKey,
      ]),
    );
    return this.prisma.$transaction(async (tx) => {
      if (facilityId)
        await this.authorizeInviter(tx, facilityId, actorId, requestedRole);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${digest}))`;
      const existing = await tx.enrollmentRequest.findUnique({
        where: { idempotencyDigest: digest },
        select: { id: true },
      });
      if (existing)
        return {
          requestId: existing.id,
          status: "VERIFICATION_PENDING" as const,
        };
      const request = await tx.enrollmentRequest.create({
        data: {
          requestedRole,
          identityCiphertext: protectIdentity(this.config, identity),
          idempotencyDigest: digest,
          facilityId,
          invitedByUserId: actorId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await tx.accountInvitationDelivery.createMany({
        data: ["EMAIL", "SMS"].map((channel) => ({
          purpose: "ENROLLMENT",
          enrollmentId: request.id,
          channel: channel as "EMAIL" | "SMS",
          recipient: "",
          status: "QUEUED" as const,
        })),
      });
      if (actorId)
        await tx.administrativeAuditEvent.create({
          data: {
            actorUserId: actorId,
            actorRole: "INSTITUTIONAL_INVITER",
            action: "ENROLLMENT_REQUESTED",
            resourceId: request.id,
            facilityId,
            afterState: { requestedRole },
          },
        });
      return { requestId: request.id, status: "VERIFICATION_PENDING" as const };
    });
  }

  async bulk(
    inputs: EnrollmentIdentity[],
    idempotencyKey: string,
    facilityId: string,
    actorId: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 150)
      throw new BadRequestException("A request idempotency key is required.");
    // Validate every phone before accepting any row. Keys are bound to submitted data, never global account state.
    inputs.forEach((input) => toE164(input.phoneNumber));
    const receipts = [];
    for (const [index, input] of inputs.entries())
      receipts.push({
        index,
        ...(await this.request(
          input,
          idempotencyKey + ":" + index,
          facilityId,
          actorId,
        )),
      });
    return { requests: receipts };
  }

  async list(facilityId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorizeInviter(tx, facilityId, actorId);
      const rows = await tx.enrollmentRequest.findMany({
        where: { facilityId },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          acceptedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        requests: rows.map((row) => ({
          requestId: row.id,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          status: row.acceptedAt
            ? "ACCEPTED"
            : row.expiresAt <= new Date()
              ? "EXPIRED"
              : "VERIFICATION_PENDING",
        })),
      };
    });
  }

  private async authorizeInviter(
    tx: Prisma.TransactionClient,
    facilityId: string,
    actorId?: string,
    requestedRole: "USER" | "FACILITY_ADMIN" | "FACILITY_OPERATOR" = "USER",
  ) {
    if (!actorId)
      throw new ForbiddenException("Enrollment authority required.");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId}::uuid FOR SHARE`;
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (
      !actor?.isActive ||
      actor.accountStatus !== "ACTIVE" ||
      !(
        actor.role === "ADMIN" ||
        (requestedRole === "USER" &&
          actor.role === "FACILITY_ADMIN" &&
          actor.facilityId === facilityId)
      )
    )
      throw new ForbiddenException("Enrollment authority required.");
    await tx.$queryRaw`SELECT id FROM "Facility" WHERE id = ${facilityId}::uuid FOR SHARE`;
    const facility = await tx.facility.findUnique({
      where: { id: facilityId },
    });
    if (!facility?.isActive)
      throw new ForbiddenException("Enrollment authority required.");
  }

  private async locked(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "EnrollmentRequest" WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.enrollmentRequest.findUnique({ where: { id } });
  }

  async verify(dto: VerifyEnrollmentDto) {
    const passwordHash = await bcrypt.hash(
      dto.password,
      this.config.getOrThrow<number>("BCRYPT_ROUNDS"),
    );
    const outcome = await this.prisma
      .$transaction(async (tx) => {
        const request = await this.locked(tx, dto.requestId);
        if (
          !request ||
          request.revokedAt ||
          request.expiresAt <= new Date() ||
          request.acceptedAt ||
          request.verifiedAt ||
          request.proofAttempts >= 5
        )
          return null;
        const emailValid = matches(dto.emailCode, request.emailTokenHash);
        const phoneValid = matches(dto.phoneCode, request.phoneTokenHash);
        if (!emailValid || !phoneValid) {
          await tx.enrollmentRequest.update({
            where: { id: request.id },
            data: { proofAttempts: { increment: 1 } },
          });
          return null;
        }
        const identity = await resolveEnrollmentIdentity<EnrollmentIdentity>(
          tx,
          this.config,
          request.identityCiphertext,
          {
            sourceId: request.id,
            facilityId: request.facilityId,
            purpose: "ENROLLMENT_VERIFY",
          },
        );
        for (const value of [
          "email:" + identity.email,
          "phone:" + identity.phoneNumber,
        ].sort()) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${value}))`;
        }
        const existing = await tx.user.findFirst({
          where: {
            OR: [
              { email: identity.email },
              { phoneNumber: identity.phoneNumber },
            ],
          },
          select: {
            id: true,
            email: true,
            phoneNumber: true,
            role: true,
            facilityId: true,
            accountStatus: true,
            isActive: true,
          },
        });
        const acceptanceToken = randomBytes(32).toString("base64url");
        await tx.enrollmentRequest.update({
          where: { id: request.id },
          data: {
            verifiedAt: new Date(),
            emailTokenHash: null,
            phoneTokenHash: null,
            acceptanceTokenHash: hash(acceptanceToken),
          },
        });
        await tx.accountInvitationDelivery.updateMany({
          where: { enrollmentId: request.id, status: "QUEUED" },
          data: { status: "CANCELLED" },
        });
        // Recover a legacy unclaimed staff seat after BOTH proofs, never from the old activation secret.
        if (
          existing &&
          existing.accountStatus === "PENDING_ACTIVATION" &&
          existing.isActive &&
          existing.email === identity.email &&
          existing.phoneNumber === identity.phoneNumber &&
          existing.role === request.requestedRole &&
          existing.facilityId === request.facilityId &&
          ["FACILITY_OPERATOR", "FACILITY_ADMIN"].includes(existing.role)
        ) {
          await this.authorizeInviter(
            tx,
            request.facilityId!,
            request.invitedByUserId ?? undefined,
            request.requestedRole as "FACILITY_OPERATOR" | "FACILITY_ADMIN",
          );
          const claimed = await tx.user.updateMany({
            where: {
              id: existing.id,
              accountStatus: "PENDING_ACTIVATION",
              isActive: true,
              facilityId: request.facilityId,
              role: existing.role,
              email: identity.email,
              phoneNumber: identity.phoneNumber,
            },
            data: {
              passwordHash,
              accountStatus: "ACTIVE",
              activatedAt: new Date(),
              activationTokenHash: null,
              activationExpiresAt: null,
              credentialVersion: { increment: 1 },
            },
          });
          if (claimed.count !== 1) throw new BadRequestException(FAILURE);
          const user = await tx.user.findUniqueOrThrow({
            where: { id: existing.id },
          });
          await this.complete(tx, request, user.id);
          return { status: "ACCEPTED" as const, user };
        }
        if (existing)
          return {
            status: "AUTHENTICATION_REQUIRED" as const,
            acceptanceToken,
          };
        if (request.facilityId)
          await this.authorizeInviter(
            tx,
            request.facilityId,
            request.invitedByUserId ?? undefined,
            request.requestedRole as
              "USER" | "FACILITY_ADMIN" | "FACILITY_OPERATOR",
          );
        const user = await tx.user.create({
          data: {
            ...identity,
            passwordHash,
            facilityId: request.facilityId,
            invitedByUserId: request.invitedByUserId,
            role: request.requestedRole ?? "USER",
            accountStatus: "ACTIVE",
            isActive: true,
            activatedAt: new Date(),
          },
        });
        await this.complete(tx, request, user.id);
        return { status: "ACCEPTED" as const, user };
      })
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          throw new BadRequestException(FAILURE);
        throw error;
      });
    if (!outcome) throw new BadRequestException(FAILURE);
    return outcome;
  }

  async accept(actorId: string, dto: AcceptEnrollmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.locked(tx, dto.requestId);
      if (
        !request ||
        request.revokedAt ||
        !request.verifiedAt ||
        request.expiresAt <= new Date() ||
        !matches(dto.acceptanceToken, request.acceptanceTokenHash)
      )
        throw new BadRequestException(FAILURE);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId}))`;
      // Serialize with administrative lifecycle/identifier changes, including writers without advisory locks.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actorId } });
      const identity = await resolveEnrollmentIdentity<EnrollmentIdentity>(
        tx,
        this.config,
        request.identityCiphertext,
        {
          sourceId: request.id,
          facilityId: request.facilityId,
          actorUserId: actorId,
          purpose: "ENROLLMENT_ACCEPT",
        },
      );
      if (
        !user?.isActive ||
        user.accountStatus !== "ACTIVE" ||
        (user.role !== "USER" && user.role !== request.requestedRole) ||
        user.email !== identity.email ||
        user.phoneNumber !== identity.phoneNumber
      )
        throw new UnauthorizedException(FAILURE);
      if (request.acceptedAt) {
        if (request.acceptedUserId !== actorId)
          throw new BadRequestException(FAILURE);
        return { status: "ACCEPTED" as const };
      }
      if (request.facilityId) {
        await this.authorizeInviter(
          tx,
          request.facilityId,
          request.invitedByUserId ?? undefined,
          request.requestedRole as
            "USER" | "FACILITY_ADMIN" | "FACILITY_OPERATOR",
        );
        if (user.facilityId !== null && user.facilityId !== request.facilityId)
          throw new BadRequestException(FAILURE);
        await tx.user.update({
          where: { id: user.id, facilityId: user.facilityId },
          data: {
            facilityId: request.facilityId,
            role: request.requestedRole ?? "USER",
            ...(user.role !== (request.requestedRole ?? "USER") ? { credentialVersion: { increment: 1 } } : {}),
          },
        });
      }
      await this.complete(tx, request, user.id);
      return { status: "ACCEPTED" as const };
    });
  }

  private async complete(
    tx: Prisma.TransactionClient,
    request: EnrollmentRequest,
    userId: string,
  ) {
    await tx.enrollmentRequest.update({
      where: { id: request.id },
      data: { acceptedAt: new Date(), acceptedUserId: userId },
    });
    await tx.administrativeAuditEvent.create({
      data: {
        actorUserId: userId,
        actorRole: request.requestedRole ?? "USER",
        action: "ENROLLMENT_ACCEPTED",
        afterState: {
          userId,
          requestedRole: request.requestedRole ?? "USER",
          invitedByUserId: request.invitedByUserId,
        },
        resourceId: request.id,
        facilityId: request.facilityId,
      },
    });
  }
}
