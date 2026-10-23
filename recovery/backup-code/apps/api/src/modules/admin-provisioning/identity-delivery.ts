import {
  enrollmentOtpDigest,
  newEnrollmentOtp,
} from "../../shared/security/enrollment-otp";
import { activationReference } from "../../shared/security/activation-reference";
import { enrollmentDestination } from "../../shared/security/enrollment-navigation";
import { ForbiddenException } from "@nestjs/common";
import {
  enrollmentAuthority,
  enrollmentSupportCase,
  type InstitutionalRole,
} from "../onboarding/support-authority";
import type { ConfigService } from "@nestjs/config";
import type { AccountInvitationDelivery, Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { resolveEnrollmentIdentity } from "../../shared/security/enrollment-resolution";
import { hashActivationCredential } from "../../shared/security/activation-code";
import type { EnrollmentIdentity } from "../auth/enrollment.service";
export type IdentityMessage = {
  recipient: string;
  message: string;
  subject: string;
  channel: "EMAIL" | "SMS";
};
/** Preparation inside the existing outbox worker transaction, never the HTTP request. */
export async function prepareIdentityDelivery(
  tx: Prisma.TransactionClient,
  delivery: AccountInvitationDelivery,
  config: ConfigService,
): Promise<IdentityMessage | null> {
  if (delivery.purpose === "ENROLLMENT" && delivery.enrollmentId) {
    const request = await tx.enrollmentRequest.findUnique({
      where: { id: delivery.enrollmentId },
    });
    if (
      !request ||
      request.revokedAt ||
      request.expiresAt <= new Date() ||
      request.verifiedAt ||
      request.acceptedAt ||
      request.proofAttempts >= 5
    )
      return null;
    let organization = "OPA personal account";
    let inviter = "OPA onboarding team";
    if (request.facilityId || request.requestedRole === "TECHNICAL_SUPPORT") {
      try {
        const authority = await enrollmentAuthority(
          tx,
          request.invitedByUserId ?? undefined,
          request.facilityId,
          request.requestedRole as InstitutionalRole,
          await enrollmentSupportCase(tx, request.id, request.invitedByUserId),
        );
        inviter =
          (
            {
              ADMIN: "OPA administrator",
              TECHNICAL_SUPPORT: "OPA Technical Support",
              FACILITY_ADMIN: "Facility administrator",
              FACILITY_OPERATOR: "Facility operator",
            } as Record<string, string>
          )[authority.actorRole] ?? "OPA onboarding team";
      } catch (error) {
        if (error instanceof ForbiddenException) return null;
        throw error;
      }
      if (request.facilityId)
        organization = (
          await tx.facility.findUniqueOrThrow({
            where: { id: request.facilityId },
          })
        ).name;
      else organization = "OPA Technical Support team";
    }
    const identity = await resolveEnrollmentIdentity<EnrollmentIdentity>(
      tx,
      config,
      request.identityCiphertext,
      {
        sourceId: request.id,
        facilityId: request.facilityId,
        purpose: "ENROLLMENT_DELIVERY",
      },
    );
    const destination = enrollmentDestination(
      config.get<string>("OPA_WEB_URL"),
      activationReference(config, request.id),
      config.get<string>("OPA_ENVIRONMENT"),
    );
    const isEmail = delivery.channel === "EMAIL";
    const channel = isEmail ? "EMAIL" : "SMS";
    const code = newEnrollmentOtp(
      config,
      request.id,
      channel,
      isEmail ? request.emailTokenHash : request.phoneTokenHash,
    );
    await tx.enrollmentRequest.update({
      where: { id: request.id },
      data: isEmail
        ? {
            emailTokenHash: enrollmentOtpDigest(
              config,
              request.id,
              channel,
              code,
            ),
          }
        : {
            phoneTokenHash: enrollmentOtpDigest(
              config,
              request.id,
              channel,
              code,
            ),
          },
    });
    return {
      channel: isEmail ? "EMAIL" : "SMS",
      recipient: isEmail ? identity.email : identity.phoneNumber,
      subject: "Your invitation to activate OPA",
      message: `${request.invitedByUserId ? "OPA invitation for " + (isEmail ? organization : Array.from(organization.replace(/\s+/g, " ").trim()).slice(0, 40).join("")) + ". Invited by: " + inviter + "." : "OPA: A personal account was requested with your contact details."}\n${destination}\n${isEmail ? "Email" : "Phone"} verification code: ${code}. Expires ${request.expiresAt.toUTCString()}. Use both codes in OPA. Ignore if unexpected.`,
    };
  }
  if (delivery.purpose === "PASSWORD_RESET" && delivery.requestCiphertext) {
    const { email } = await resolveEnrollmentIdentity<{ email: string }>(
      tx,
      config,
      delivery.requestCiphertext,
      { sourceId: delivery.id, purpose: "PASSWORD_RESET_DELIVERY" },
    );
    const candidate = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!candidate) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.id}))`;
    const user = await tx.user.findUnique({ where: { id: candidate.id } });
    if (
      !user?.isActive ||
      user.accountStatus !== "ACTIVE" ||
      !user.passwordHash ||
      user.email !== email
    )
      return null;
    const code = randomBytes(32).toString("hex");
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashActivationCredential(code),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const webUrl = config.get<string>("OPA_WEB_URL")?.trim();
    const link = webUrl
      ? new URL(
          `/reset-password?token=${encodeURIComponent(code)}`,
          webUrl,
        ).toString()
      : "";
    return {
      channel: "EMAIL",
      recipient: email,
      subject: "Reset your OPA password",
      message: `A password reset was requested for your OPA account.\n${link}\nOpen OPA, choose Forgot password, then I have a reset token.\n${code}\nThis token expires in 30 minutes and can be used once. Ignore this email if you did not request it.`,
    };
  }
  return null;
}
