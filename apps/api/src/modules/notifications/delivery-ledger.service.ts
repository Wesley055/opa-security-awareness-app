import { Injectable } from "@nestjs/common";
import {
  DeliveryAttempt,
  DeliveryFailureCategory,
  DeliveryStatus,
  NotificationStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  ATTEMPT_TIMEOUT_MS,
  MAX_DELIVERY_ATTEMPTS,
  providerIdentity,
  receiptStatus,
  retryDelay,
} from "./delivery-policy";
import type { NotificationResponse } from "./providers/notification-provider.interface";

export type DeliveryOwner = { kind: "incident" | "invitation" | "safewalk"; id: string };
type Tx = Prisma.TransactionClient;
type Projection = {
  deliveryStatus?: DeliveryStatus;
  status?: NotificationStatus;
  attemptCount?: number;
  firstAttemptAt?: Date;
  lastAttemptAt?: Date;
  providerAcceptedAt?: Date;
  confirmedDeliveredAt?: Date;
  failureCategory?: DeliveryFailureCategory | null;
  nextAttemptAt?: Date;
  provider?: string;
  providerMessageId?: string;
  sentAt?: Date;
  failedAt?: Date | null;
  lastError?: string | null;
};

@Injectable()
export class DeliveryLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private ownerFields(owner: DeliveryOwner) {
    if (owner.kind === "safewalk") return { safeWalkNoticeId: owner.id };
    return owner.kind === "incident"
      ? { incidentNotificationId: owner.id }
      : { invitationDeliveryId: owner.id };
  }

  private owner(attempt: DeliveryAttempt): DeliveryOwner {
    if (attempt.safeWalkNoticeId) return { kind: "safewalk", id: attempt.safeWalkNoticeId };
    return attempt.incidentNotificationId
      ? { kind: "incident", id: attempt.incidentNotificationId }
      : { kind: "invitation", id: attempt.invitationDeliveryId! };
  }

  private async lock(tx: Tx, owner: DeliveryOwner) {
    if (owner.kind === "safewalk") {
      await tx.$queryRaw`SELECT id FROM "SafeWalkNotice" WHERE id = ${owner.id}::uuid FOR UPDATE`;
      return tx.safeWalkNotice.findUnique({ where: { id: owner.id } });
    }
    // All writers lock the authoritative parent before attempts or receipts.
    if (owner.kind === "incident") {
      await tx.$queryRaw`SELECT id FROM "IncidentNotification" WHERE id = ${owner.id}::uuid FOR UPDATE`;
      return tx.incidentNotification.findUnique({ where: { id: owner.id } });
    }
    await tx.$queryRaw`SELECT id FROM "AccountInvitationDelivery" WHERE id = ${owner.id}::uuid FOR UPDATE`;
    return tx.accountInvitationDelivery.findUnique({ where: { id: owner.id } });
  }

  private async project(tx: Tx, owner: DeliveryOwner, data: Projection) {
    if (owner.kind === "safewalk") { await tx.safeWalkNotice.update({ where: { id: owner.id }, data }); return; }
    if (owner.kind === "incident") {
      await tx.incidentNotification.update({ where: { id: owner.id }, data });
    } else {
      await tx.accountInvitationDelivery.update({
        where: { id: owner.id },
        data,
      });
    }
  }

  async claimIncident(id: string) {
    return this.prisma.$transaction((tx) =>
      this.claim(tx, { kind: "incident", id }),
    );
  }

  // Invitation credential rotation and the claim share the caller's transaction.
  async claim(tx: Tx, owner: DeliveryOwner): Promise<DeliveryAttempt | null> {
    const row = await this.lock(tx, owner);
    const now = new Date();
    if (
      !row ||
      row.status !== "QUEUED" ||
      row.nextAttemptAt > now ||
      row.attemptCount >= MAX_DELIVERY_ATTEMPTS ||
      row.deliveryStatus === "DELIVERED"
    )
      return null;
    const number = row.attemptCount + 1;
    const attempt = await tx.deliveryAttempt.create({
      data: {
        ...this.ownerFields(owner),
        number,
        channel: row.channel,
        ...providerIdentity(row.channel),
        status: "ATTEMPTING",
        startedAt: now,
      },
    });
    await this.project(tx, owner, {
      status: "SENDING",
      deliveryStatus: "ATTEMPTING",
      attemptCount: number,
      firstAttemptAt:
        row.firstAttemptAt ?? (row.attemptCount === 0 ? now : undefined),
      lastAttemptAt: now,
      failureCategory: null,
      failedAt: null,
      lastError: null,
    });
    await tx.deliveryStatusEvent.create({
      data: {
        ...this.ownerFields(owner),
        attemptId: attempt.id,
        previousStatus: row.deliveryStatus,
        newStatus: "ATTEMPTING",
        provider: attempt.provider,
        source: "DISPATCH",
        reason: "ATTEMPT_STARTED",
        occurredAt: now,
      },
    });
    return attempt;
  }

  async rejectInTransaction(
    tx: Tx,
    attempt: DeliveryAttempt,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    await tx.deliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        completedAt: now,
        failureCategory: "REJECTED",
        retryable: false,
      },
    });
    await tx.deliveryStatusEvent.create({
      data: {
        ...this.ownerFields(this.owner(attempt)),
        attemptId: attempt.id,
        previousStatus: "ATTEMPTING",
        newStatus: "FAILED",
        source: "ELIGIBILITY",
        provider: attempt.provider,
        reason,
        failureCategory: "REJECTED",
        occurredAt: now,
      },
    });
  }

  async complete(
    attemptId: string,
    response: NotificationResponse,
  ): Promise<void> {
    const original = await this.prisma.deliveryAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    await this.prisma.$transaction(async (tx) => {
      const owner = this.owner(original);
      const row = await this.lock(tx, owner);
      if (!row) throw new Error("Delivery owner missing");
      const attempt = await tx.deliveryAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      if (
        attempt.completedAt &&
        !(attempt.status === "UNKNOWN" && response.uncertain !== true)
      )
        return;
      const now = new Date();
      const observed: DeliveryStatus = response.success
        ? "PROVIDER_ACCEPTED"
        : response.uncertain
          ? "UNKNOWN"
          : "FAILED";
      const status = receiptStatus(attempt.status, observed);
      const failure = response.success
        ? null
        : (response.failureCategory ?? "UNKNOWN_PROVIDER_ERROR");
      const retryable =
        observed === "FAILED" &&
        response.retryable === true &&
        ![
          "AUTHENTICATION",
          "INVALID_RECIPIENT",
          "REJECTED",
          "EXPIRED",
          "INTERNAL_ERROR",
        ].includes(failure ?? "INTERNAL_ERROR");
      const messageId =
        typeof response.messageId === "string" &&
        response.messageId.length > 0 &&
        response.messageId.length <= 256
          ? response.messageId
          : undefined;
      if (messageId) {
        // A conflicting reference aborts this transaction; it is never reassigned.
        await tx.providerReference.create({
          data: {
            attemptId,
            provider: attempt.provider,
            accountScope: attempt.accountScope,
            messageId,
          },
        });
      }
      await tx.deliveryAttempt.update({
        where: { id: attemptId },
        data: {
          status,
          completedAt: now,
          failureCategory: status === "DELIVERED" ? null : failure,
          providerAcceptedAt: response.success
            ? (attempt.providerAcceptedAt ?? now)
            : undefined,
          retryable,
        },
      });
      await tx.deliveryStatusEvent.create({
        data: {
          ...this.ownerFields(owner),
          attemptId,
          previousStatus: attempt.status,
          newStatus: status,
          source: "PROVIDER_RESPONSE",
          provider: attempt.provider,
          reason:
            observed === "PROVIDER_ACCEPTED"
              ? "REQUEST_ACCEPTED"
              : observed === "UNKNOWN"
                ? "OUTCOME_UNCERTAIN"
                : "REQUEST_FAILED",
          failureCategory: failure,
          occurredAt: now,
        },
      });
      const firstAccepted =
        response.success && !row.providerAcceptedAt ? now : undefined;
      if (
        row.attemptCount !== attempt.number ||
        row.deliveryStatus === "DELIVERED"
      ) {
        if (firstAccepted)
          await this.project(tx, owner, { providerAcceptedAt: firstAccepted });
        return;
      }
      const delay = retryDelay(attempt.number, retryable);
      await this.project(tx, owner, {
        deliveryStatus: status,
        status: response.success
          ? "SENT"
          : delay !== null
            ? "QUEUED"
            : "FAILED",
        provider: attempt.provider,
        providerMessageId: messageId,
        providerAcceptedAt: firstAccepted,
        sentAt: response.success ? now : undefined,
        failedAt: response.success ? null : now,
        failureCategory: failure,
        lastError: failure,
        nextAttemptAt:
          delay !== null ? new Date(now.getTime() + delay) : undefined,
      });
      if (delay !== null) {
        await tx.deliveryStatusEvent.create({
          data: {
            ...this.ownerFields(owner),
            attemptId,
            previousStatus: status,
            newStatus: status,
            source: "RETRY_POLICY",
            provider: attempt.provider,
            reason: "RETRY_SCHEDULED",
            failureCategory: failure,
            occurredAt: now,
          },
        });
      }
    });
  }

  async recoverStale(): Promise<void> {
    const before = new Date(Date.now() - ATTEMPT_TIMEOUT_MS);
    const attempts = await this.prisma.deliveryAttempt.findMany({
      where: { status: "ATTEMPTING", startedAt: { lte: before } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      take: 25,
    });
    for (const candidate of attempts) {
      await this.prisma.$transaction(async (tx) => {
        const owner = this.owner(candidate);
        const row = await this.lock(tx, owner);
        const attempt = await tx.deliveryAttempt.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        if (!row || attempt.status !== "ATTEMPTING") return;
        await tx.deliveryAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "UNKNOWN",
            failureCategory: "TIMEOUT",
            retryable: false,
          },
        });
        await tx.deliveryStatusEvent.create({
          data: {
            ...this.ownerFields(owner),
            attemptId: attempt.id,
            previousStatus: "ATTEMPTING",
            newStatus: "UNKNOWN",
            provider: attempt.provider,
            source: "RECOVERY",
            reason: "ATTEMPT_LEASE_EXPIRED",
            failureCategory: "TIMEOUT",
            occurredAt: new Date(),
          },
        });
        // Do not blindly resend a request that might have reached the provider.
        if (
          row.attemptCount === attempt.number &&
          row.deliveryStatus !== "DELIVERED"
        ) {
          await this.project(tx, owner, {
            status: "FAILED",
            deliveryStatus: "UNKNOWN",
            failureCategory: "TIMEOUT",
            lastError: "TIMEOUT",
          });
        }
      });
    }
  }

  async reconcileReceipts(): Promise<void> {
    const receipts = await this.prisma.providerDeliveryReceipt.findMany({
      where: { processedAt: null, nextReconcileAt: { lte: new Date() } },
      orderBy: [{ nextReconcileAt: "asc" }, { id: "asc" }],
      take: 25,
    });
    for (const receipt of receipts) await this.applyReceipt(receipt.id);
  }

  async applyReceipt(receiptId: string): Promise<void> {
    const receipt = await this.prisma.providerDeliveryReceipt.findUniqueOrThrow(
      { where: { id: receiptId } },
    );
    if (receipt.processedAt) return;
    // Defense in depth: only the provider with a verified ingress contract may
    // strengthen truth. Unsupported receipts cannot be promoted by a future
    // generic importer or by guessing an existing SMS message reference.
    if (receipt.provider !== "RESEND") {
      await this.prisma.providerDeliveryReceipt.updateMany({
        where: { id: receiptId, processedAt: null },
        data: { processedAt: new Date() },
      });
      return;
    }
    const reference = await this.prisma.providerReference.findUnique({
      where: {
        provider_accountScope_messageId: {
          provider: receipt.provider,
          accountScope: receipt.accountScope,
          messageId: receipt.messageId,
        },
      },
      include: { attempt: true },
    });
    if (!reference) {
      await this.prisma.providerDeliveryReceipt.updateMany({
        where: { id: receiptId, processedAt: null },
        data: {
          nextReconcileAt: new Date(
            Date.now() +
              Math.min(
                3_600_000,
                30_000 * 2 ** Math.min(receipt.reconcileCount, 7),
              ),
          ),
          reconcileCount: { increment: 1 },
        },
      });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const owner = this.owner(reference.attempt);
      const row = await this.lock(tx, owner);
      const fresh = await tx.providerDeliveryReceipt.findUniqueOrThrow({
        where: { id: receiptId },
      });
      if (!row || fresh.processedAt) return;
      const attempt = await tx.deliveryAttempt.findUniqueOrThrow({
        where: { id: reference.attemptId },
      });
      const status = receiptStatus(attempt.status, fresh.status);
      const delivered = status === "DELIVERED";
      await tx.deliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status,
          deliveredAt:
            fresh.status === "DELIVERED" &&
            (!attempt.deliveredAt || fresh.occurredAt < attempt.deliveredAt)
              ? fresh.occurredAt
              : undefined,
          providerAcceptedAt:
            fresh.status === "PROVIDER_ACCEPTED" &&
            (!attempt.providerAcceptedAt ||
              fresh.occurredAt < attempt.providerAcceptedAt)
              ? fresh.occurredAt
              : undefined,
          failureCategory: delivered
            ? null
            : (fresh.failureCategory ?? attempt.failureCategory),
        },
      });
      await tx.deliveryStatusEvent.create({
        data: {
          ...this.ownerFields(owner),
          attemptId: attempt.id,
          receiptId,
          previousStatus: attempt.status,
          newStatus: status,
          source: "PROVIDER_RECEIPT",
          provider: fresh.provider,
          reason: fresh.eventType,
          failureCategory: fresh.failureCategory,
          occurredAt: fresh.occurredAt,
        },
      });
      const data: Projection = {};
      if (
        fresh.status === "DELIVERED" &&
        (!row.confirmedDeliveredAt ||
          fresh.occurredAt < row.confirmedDeliveredAt)
      )
        data.confirmedDeliveredAt = fresh.occurredAt;
      if (
        fresh.status === "PROVIDER_ACCEPTED" &&
        (!row.providerAcceptedAt || fresh.occurredAt < row.providerAcceptedAt)
      )
        data.providerAcceptedAt = fresh.occurredAt;
      if (delivered) {
        data.deliveryStatus = "DELIVERED";
        data.status = "SENT"; // scheduling is complete; never claim a legacy DELIVERED backfill.
        data.failureCategory = null;
      } else if (
        row.attemptCount === attempt.number &&
        row.deliveryStatus !== "DELIVERED"
      ) {
        data.deliveryStatus = status;
        data.failureCategory = fresh.failureCategory ?? undefined;
        if (status === "FAILED") data.status = "FAILED"; // no automatic resend after provider acceptance.
      }
      if (Object.keys(data).length) await this.project(tx, owner, data);
      await tx.providerDeliveryReceipt.update({
        where: { id: receiptId },
        data: { processedAt: new Date() },
      });
    });
  }
}
