import { enrollmentDestination } from "../../shared/security/enrollment-navigation";
import {
  enrollmentAuthority,
  enrollmentSupportCase,
  type InstitutionalRole,
} from "../onboarding/support-authority";
import {
  BadRequestException,
  ConflictException,
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
    requestedRole: InstitutionalRole = "USER",
    auditContext?: {
      reason: string;
      caseReference?: string;
      correlationId: string;
    },
    firstFacilityAdmin = false,
  ) {
    if (["production", "staging"].includes(this.config.get<string>("OPA_ENVIRONMENT") ?? ""))
      enrollmentDestination(this.config.get<string>("OPA_WEB_URL"), "configuration-check");
    if (auditContext && !auditContext.reason.trim())
      throw new BadRequestException("Reason required.");
    if (
      requestedRole !== "USER" &&
      (!actorId || (requestedRole !== "TECHNICAL_SUPPORT" && !facilityId))
    )
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
        ...(auditContext ? [auditContext] : []),
      ]),
    );
    return this.prisma.$transaction(async (tx) => {
      const authority =
        facilityId || requestedRole === "TECHNICAL_SUPPORT"
          ? await this.authorizeInviter(
              tx,
              facilityId ?? null,
              actorId,
              requestedRole,
              auditContext?.caseReference,
            )
          : undefined;
      if (
        firstFacilityAdmin &&
        (requestedRole !== "FACILITY_ADMIN" ||
          authority?.provisioningMode !== "FIRST_FACILITY_ADMIN")
      )
        throw new ForbiddenException(
          "Current assigned Technical Support commissioning authority required.",
        );
      if (authority?.authority === "SUPPORT_CAPABILITY") {
        // Only compare the authenticated actor's own identifiers; never look
        // up the submitted recipient before dual ownership verification.
        const actor = await tx.user.findUniqueOrThrow({
          where: { id: actorId! },
          select: { email: true, phoneNumber: true },
        });
        if (
          actor.email.toLowerCase() === identity.email ||
          actor.phoneNumber === identity.phoneNumber
        )
          throw new ForbiddenException(
            "Technical Support employees cannot invite their own identity.",
          );
      }
      if (actorId && auditContext) {
        // The ADMIN operation receipt and canonical enrollment digest must agree.
        // This lock is shared with support receipt reconciliation; no new enrollment implementation.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId + ":canonical:" + auditContext.correlationId}))`;
        const prior = await tx.administrativeAuditEvent.findFirst({
          where: {
            actorUserId: actorId,
            correlationId: auditContext.correlationId,
          },
        });
        if (prior) {
          const same = await tx.enrollmentRequest.findUnique({
            where: { idempotencyDigest: digest },
            select: { id: true },
          });
          if (
            prior.action !== "ENROLLMENT_REQUESTED" ||
            same?.id !== prior.resourceId
          )
            throw new ConflictException(
              "Operation reference was already used for a different request.",
            );
          return {
            requestId: same.id,
            status: "VERIFICATION_PENDING" as const,
          };
        }
      }
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
            actorRole: authority?.actorRole ?? "INSTITUTIONAL_INVITER",
            action: "ENROLLMENT_REQUESTED",
            ...(authority
              ? {
                  reason: auditContext?.reason ?? "Staff onboarding invitation",
                }
              : {}),
            ...(auditContext
              ? {
                  caseReference: auditContext.caseReference,
                  correlationId: auditContext.correlationId,
                }
              : {}),
            resourceId: request.id,
            facilityId,
            afterState: { requestedRole, ...(authority ?? {}) },
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

  async list(facilityId: string, actorId: string, page = 0) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorizeInviter(tx, facilityId, actorId);
      const rows = await tx.enrollmentRequest.findMany({
        where: { facilityId },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page * 50,
        take: 51,
      });
      return {
        page,
        hasNext: rows.length > 50,
        requests: rows.slice(0, 50).map((row) => ({
          requestId: row.id,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          status: row.revokedAt
            ? "REVOKED"
            : row.acceptedAt
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
    facilityId: string | null,
    actorId?: string,
    requestedRole: InstitutionalRole = "USER",
    caseReference?: string,
  ) {
    return enrollmentAuthority(
      tx,
      actorId,
      facilityId,
      requestedRole,
      caseReference,
    );
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
            membershipState: true,
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
          existing.membershipState === "ACTIVE" &&
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
            await enrollmentSupportCase(
              tx,
              request.id,
              request.invitedByUserId,
            ),
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
        if (request.facilityId || request.requestedRole === "TECHNICAL_SUPPORT")
          await this.authorizeInviter(
            tx,
            request.facilityId,
            request.invitedByUserId ?? undefined,
            request.requestedRole as InstitutionalRole,
            await enrollmentSupportCase(
              tx,
              request.id,
              request.invitedByUserId,
            ),
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

  /** Recovery only after both original proofs, authenticated exact identity and current authority. */
  async continueVerified(actorId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.locked(tx, requestId);
      if (
        !request ||
        request.revokedAt ||
        !request.verifiedAt ||
        request.expiresAt <= new Date() ||
        request.proofAttempts >= 5
      )
        throw new BadRequestException(FAILURE);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId}))`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actorId } });
      if (
        !user?.isActive ||
        user.accountStatus !== "ACTIVE" ||
        user.membershipState !== "ACTIVE"
      )
        throw new UnauthorizedException(FAILURE);
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
        user.email !== identity.email ||
        user.phoneNumber !== identity.phoneNumber
      )
        throw new UnauthorizedException(FAILURE);
      if (
        user.role === "TECHNICAL_SUPPORT" &&
        (user.facilityId !== null ||
          (
            await tx.supportEmployment.findUnique({
              where: { userId: actorId },
            })
          )?.state !== "ACTIVE")
      )
        throw new UnauthorizedException(FAILURE);
      if (request.acceptedAt) {
        if (
          request.acceptedUserId !== actorId ||
          user.role !== request.requestedRole ||
          user.facilityId !== request.facilityId
        )
          throw new UnauthorizedException(FAILURE);
        return { status: "ACCEPTED" as const, role: user.role };
      }
      if (request.facilityId || request.requestedRole === "TECHNICAL_SUPPORT")
        await this.authorizeInviter(
          tx,
          request.facilityId,
          request.invitedByUserId ?? undefined,
          request.requestedRole as InstitutionalRole,
          await enrollmentSupportCase(tx, request.id, request.invitedByUserId),
        );
      const acceptanceToken = randomBytes(32).toString("base64url");
      await tx.enrollmentRequest.update({
        where: { id: request.id },
        data: { acceptanceTokenHash: hash(acceptanceToken) },
      });
      return { status: "AUTHENTICATION_REQUIRED" as const, acceptanceToken };
    });
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
        return {
          status: "ACCEPTED" as const,
          role: request.requestedRole ?? "USER",
        };
      }
      if (request.facilityId || request.requestedRole === "TECHNICAL_SUPPORT") {
        const authority = await this.authorizeInviter(
          tx,
          request.facilityId,
          request.invitedByUserId ?? undefined,
          request.requestedRole as InstitutionalRole,
          await enrollmentSupportCase(tx, request.id, request.invitedByUserId),
        );
        if (
          authority?.authority === "SUPPORT_CAPABILITY" &&
          actorId === request.invitedByUserId
        )
          throw new ForbiddenException(
            "Technical Support employees cannot accept their own staff invitation.",
          );
        if (
          user.membershipState !== "ACTIVE" ||
          (user.facilityId !== null && user.facilityId !== request.facilityId)
        )
          throw new BadRequestException(FAILURE);
        await tx.user.update({
          where: { id: user.id, facilityId: user.facilityId },
          data: {
            facilityId: request.facilityId,
            role: request.requestedRole ?? "USER",
            ...(user.role !== (request.requestedRole ?? "USER")
              ? { credentialVersion: { increment: 1 } }
              : {}),
          },
        });
      }
      await this.complete(tx, request, user.id);
      return {
        status: "ACCEPTED" as const,
        role: request.requestedRole ?? "USER",
      };
    });
  }

  private async complete(
    tx: Prisma.TransactionClient,
    request: EnrollmentRequest,
    userId: string,
  ) {
    if (request.requestedRole === "TECHNICAL_SUPPORT") {
      await enrollmentAuthority(
        tx,
        request.invitedByUserId ?? undefined,
        null,
        "TECHNICAL_SUPPORT",
      );
      await tx.supportEmployment.upsert({
        where: { userId },
        create: {
          userId,
          appointedByUserId: request.invitedByUserId!,
          state: "ACTIVE",
        },
        update: {},
      });
    }
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
