import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Caller locks the enrollment and revalidates authority in the same transaction. */
export async function applyEnrollmentDeliveryAction(
  tx: Prisma.TransactionClient,
  row: Prisma.EnrollmentRequestGetPayload<{ include: { deliveries: true } }>,
  action: "resend" | "revoke",
  facilityActive: boolean,
) {
  const id = row.id;
  if (row.acceptedAt || row.revokedAt)
    throw new ConflictException("Invitation is no longer eligible.");
  if (action === "revoke") {
    await tx.enrollmentRequest.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        emailTokenHash: null,
        phoneTokenHash: null,
        acceptanceTokenHash: null,
      },
    });
    await tx.accountInvitationDelivery.updateMany({
      where: { enrollmentId: id, status: "QUEUED" },
      data: { status: "CANCELLED" },
    });
  } else {
    if (!facilityActive || row.verifiedAt || row.proofAttempts >= 5)
      throw new ConflictException("Invitation is no longer eligible.");
    const cooldown = Math.max(
      row.createdAt.getTime(),
      row.lastResentAt?.getTime() ?? 0,
      ...row.deliveries.map((d) => d.lastAttemptAt?.getTime() ?? 0),
    );
    if (
      Date.now() - cooldown < 300000 ||
      row.deliveries.some(
        (d) => d.status === "QUEUED" || d.status === "SENDING",
      )
    )
      throw new ConflictException(
        "Wait five minutes and until delivery completes before resending.",
      );
    await tx.enrollmentRequest.update({
      where: { id },
      data: {
        lastResentAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        emailTokenHash: null,
        phoneTokenHash: null,
      },
    });
    // Reuse the channel-unique outbox rows, retaining monotonically increasing attempts.
    await tx.accountInvitationDelivery.updateMany({
      where: { enrollmentId: id },
      data: {
        status: "QUEUED",
        nextAttemptAt: new Date(),
        lastError: null,
        failedAt: null,
      },
    });
  }
}
