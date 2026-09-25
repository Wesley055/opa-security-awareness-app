import { ForbiddenException } from "@nestjs/common";
import { onboardingAuthority } from "../onboarding/onboarding-authority";
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
    if (request.facilityId) {
      const inviter = await tx.user.findUnique({
        where: { id: request.invitedByUserId! },
      });
      const facility = await tx.facility.findUnique({
        where: { id: request.facilityId },
      });
      if (
        !facility?.isActive ||
        !inviter?.isActive ||
        inviter.accountStatus !== "ACTIVE"
      )
        return null;
      if (
        ["FACILITY_ADMIN", "FACILITY_OPERATOR"].includes(request.requestedRole)
      ) {
        try {
          await onboardingAuthority(tx, inviter.id, facility.id);
        } catch (error) {
          if (error instanceof ForbiddenException) return null;
          throw error;
        }
      } else if (!(
        inviter.role === "ADMIN" ||
        ((request.requestedRole ?? "USER") === "USER" &&
          inviter.role === "FACILITY_ADMIN" &&
          inviter.facilityId === request.facilityId)
      ))
        return null;
      organization = facility.name;
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
    const code = randomBytes(32).toString("base64url");
    const isEmail = delivery.channel === "EMAIL";
    await tx.enrollmentRequest.update({
      where: { id: request.id },
      data: isEmail
        ? { emailTokenHash: hashActivationCredential(code) }
        : { phoneTokenHash: hashActivationCredential(code) },
    });
    return {
      channel: isEmail ? "EMAIL" : "SMS",
      recipient: isEmail ? identity.email : identity.phoneNumber,
      subject: "Verify your OPA enrollment request",
      message: `OPA enrollment for ${organization}\nRequest: ${request.id}\n${isEmail ? "Email" : "Phone"} code: ${code}\nExpires: ${request.expiresAt.toISOString()}. Enter both codes in OPA only if you intend to enroll.${config.get<string>("OPA_WEB_URL") ? "\nEnroll: " + new URL("/enroll", config.get<string>("OPA_WEB_URL")).toString() : ""}`,
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
          `/operator/reset-password?token=${encodeURIComponent(code)}`,
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
