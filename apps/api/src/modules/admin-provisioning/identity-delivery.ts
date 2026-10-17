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
import {
  enrollmentCodeDigest,
  generateEnrollmentOtp,
  hashActivationCredential,
} from "../../shared/security/activation-code";
import type { EnrollmentIdentity } from "../auth/enrollment.service";
/** Expiry in Nigerian time, e.g. "18 Oct, 14:30 WAT". */
export function enrollmentExpiryText(at: Date): string {
  const text = at.toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${text} WAT`;
}
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
    if (
      request.facilityId ||
      request.requestedRole === "TECHNICAL_SUPPORT" ||
      request.requestedRole === "ORGANIZATION_ADMIN"
    ) {
      try {
        await enrollmentAuthority(
          tx,
          request.invitedByUserId ?? undefined,
          request.facilityId,
          request.requestedRole as InstitutionalRole,
          await enrollmentSupportCase(tx, request.id, request.invitedByUserId),
        );
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
      else if (request.organizationId)
        organization =
          (
            await tx.organization.findUniqueOrThrow({
              where: { id: request.organizationId },
            })
          ).name + " Head Office";
      else organization = "OPA support employment";
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
    const destination = enrollmentDestination(config.get<string>("OPA_WEB_URL"), request.id, config.get<string>("OPA_ENVIRONMENT"));
    // A fresh code per delivery: issuing it overwrites the stored digest, so
    // any earlier code for this channel stops working.
    const code = generateEnrollmentOtp();
    const isEmail = delivery.channel === "EMAIL";
    const digest = enrollmentCodeDigest(code, config.getOrThrow<string>("ENROLLMENT_ENCRYPTION_KEY"));
    await tx.enrollmentRequest.update({
      where: { id: request.id },
      data: isEmail ? { emailTokenHash: digest } : { phoneTokenHash: digest },
    });
    const validUntil = enrollmentExpiryText(request.expiresAt);
    return isEmail
      ? {
          channel: "EMAIL",
          recipient: identity.email,
          subject: `Your OPA code: ${code}`,
          message: `Your OPA verification code for ${organization} is ${code}.\n\nOpen ${destination} and enter this code with the code we sent to your phone, then choose your password.\n\nValid until ${validUntil}. If you were not expecting this, you can ignore this email.`,
        }
      : {
          channel: "SMS",
          recipient: identity.phoneNumber,
          subject: `Your OPA code: ${code}`,
          message: `OPA: your code for ${organization} is ${code}. Enter it with the code sent to your email: ${destination} Valid until ${validUntil}.`,
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
