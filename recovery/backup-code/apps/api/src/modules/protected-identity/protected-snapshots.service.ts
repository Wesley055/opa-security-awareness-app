import { markDeliveryFailure } from "../notifications/delivery-diagnostics";
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ProtectedIdentityService } from "./protected-identity.service";
import { isNotificationPayloadV1 } from "../notifications/notification-payload";
import type { NotificationPayloadV1 } from "../notifications/notification-payload";
import type { CryptoContext } from "./identity-crypto";

export type SnapshotKind = "INVITATION_SNAPSHOT" | "NOTIFICATION_SNAPSHOT";
const missing = () => new NotFoundException("Protected identity not found.");
const failed = () =>
  new ServiceUnavailableException("Protected snapshot unavailable.");

@Injectable()
export class ProtectedSnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identities: ProtectedIdentityService,
  ) {}

  private deliveryActor(tenantId: string): string {
    let actor = process.env.PII_DELIVERY_ACTOR_USER_ID;
    if (process.env.PII_DELIVERY_ACTORS_JSON) {
      try {
        const values: unknown = JSON.parse(
          process.env.PII_DELIVERY_ACTORS_JSON,
        );
        if (!values || typeof values !== "object" || Array.isArray(values))
          throw markDeliveryFailure(failed(), "DELIVERY_ACTOR_UNAVAILABLE");
        const selected = (values as Record<string, unknown>)[tenantId];
        if (typeof selected !== "string") throw markDeliveryFailure(failed(), "DELIVERY_ACTOR_UNAVAILABLE");
        actor = selected;
      } catch {
        throw markDeliveryFailure(failed(), "DELIVERY_ACTOR_UNAVAILABLE");
      }
    }
    if (!actor || !/^[0-9a-f-]{36}$/i.test(actor)) throw markDeliveryFailure(failed(), "DELIVERY_ACTOR_UNAVAILABLE");
    return actor;
  }

  /** Internal migration boundary. Dry-run by default. No tenant inferred from a facility. */
  async backfill(
    actorUserId: string,
    tenantId: string,
    kind: SnapshotKind,
    sourceId: string,
    expectedUpdatedAt: Date,
    apply = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.identities.authorize(tx, tenantId, actorUserId, "WRITE");
      // Locks serialize cutover against the workers' optimistic QUEUED -> SENDING claim.
      if (kind === "INVITATION_SNAPSHOT") {
        await tx.$queryRaw`SELECT id FROM "AccountInvitationDelivery" WHERE id = ${sourceId}::uuid FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM "IncidentNotification" WHERE id = ${sourceId}::uuid FOR UPDATE`;
      }
      const invitation =
        kind === "INVITATION_SNAPSHOT"
          ? await tx.accountInvitationDelivery.findUnique({
              where: { id: sourceId },
            })
          : null;
      const notification =
        kind === "NOTIFICATION_SNAPSHOT"
          ? await tx.incidentNotification.findUnique({
              where: { id: sourceId },
              include: {
                incident: { select: { userId: true, facilityId: true } },
              },
            })
          : null;
      const source = invitation ?? notification;
      const subjectUserId = invitation?.userId ?? notification?.incident.userId;
      if (!source || !subjectUserId) throw missing();
      if (
        invitation
          ? invitation.facilityId !== tenantId ||
            invitation.purpose !== "LEGACY_INVITATION"
          : notification?.incident.facilityId !== tenantId
      )
        throw missing();
      const membership = await tx.user.findFirst({
        where: {
          facilityId: tenantId,
          id: subjectUserId,
          isActive: true,
          facility: { isActive: true },
        },
      });
      if (!membership) throw missing();
      const context: CryptoContext = {
        tenantId,
        subjectUserId,
        sourceId,
        kind,
      };
      if (source.protectedSnapshotId) {
        const existing = await tx.protectedIdentifier.findFirst({
          where: { id: source.protectedSnapshotId, ...context },
        });
        if (!existing) throw missing();
        // Replays verify authentication and source binding through the audited delivery boundary.
        const verified = await this.resolve(
          existing.id,
          sourceId,
          subjectUserId,
          kind,
          tx,
        );
        if (
          verified.version !== 1 ||
          (kind === "INVITATION_SNAPSHOT"
            ? typeof verified.recipient !== "string" ||
              !verified.recipient.trim()
            : !validNotificationPayload(verified.payload))
        )
          throw failed();
        return { sourceId, status: "ALREADY_PROTECTED" as const };
      }
      if (
        source.status === "SENDING" ||
        source.updatedAt.getTime() !== expectedUpdatedAt.getTime()
      )
        throw failed();
      // Verify delivery authority before erasing any legacy dispatch fields.
      await this.identities.authorize(
        tx,
        tenantId,
        this.deliveryActor(tenantId),
        "DELIVERY",
      );
      const snapshot = invitation
        ? {
            version: 1,
            recipient: invitation.recipient,
            legacyLastError: invitation.lastError,
          }
        : {
            version: 1,
            contactName: notification!.contactName,
            legacyLastError: notification!.lastError,
            payload: notification!.payload,
          };
      if (
        invitation
          ? !invitation.recipient.trim()
          : !validNotificationPayload(notification!.payload)
      )
        throw failed();
      if (!apply) return { sourceId, status: "READY" as const };
      const protectedRow = await this.identities.protectInTransaction(
        tx,
        actorUserId,
        context,
        JSON.stringify(snapshot),
      );
      if (invitation) {
        await tx.accountInvitationDelivery.update({
          where: { id: sourceId },
          data: {
            protectedSnapshotId: protectedRow.id,
            recipient: "[protected]",
            lastError: null,
          },
        });
      } else {
        await tx.incidentNotification.update({
          where: { id: sourceId },
          data: {
            protectedSnapshotId: protectedRow.id,
            recipient: "[protected]",
            contactName: "[protected]",
            payload: Prisma.DbNull,
            lastError: null,
          },
        });
      }
      return { sourceId, status: "PROTECTED" as const };
    });
  }

  /** Creates no competing crypto or tenant authority. Called inside the outbox transaction. */
  async notificationData(
    tx: Prisma.TransactionClient,
    data: Prisma.IncidentNotificationCreateManyInput,
  ): Promise<Prisma.IncidentNotificationCreateManyInput> {
    const incident = await tx.incident.findUniqueOrThrow({
      where: { id: data.incidentId },
      select: { userId: true, facilityId: true },
    });
    // Personal accounts have no institutional Protected Identity tenant or grant.
    if (!incident.facilityId) return data;
    if (!data.id || !isNotificationPayloadV1(data.payload)) throw failed();
    const actor = this.deliveryActor(incident.facilityId);
    await this.identities.authorize(tx, incident.facilityId, actor, "DELIVERY");
    const row = await this.identities.protectInTransaction(
      tx,
      actor,
      {
        tenantId: incident.facilityId,
        subjectUserId: incident.userId,
        sourceId: data.id,
        kind: "NOTIFICATION_SNAPSHOT",
      },
      JSON.stringify({
        version: 1,
        contactName: data.contactName,
        payload: data.payload,
      }),
    );
    return {
      ...data,
      recipient: "[protected]",
      contactName: "[protected]",
      payload: Prisma.DbNull,
      protectedSnapshotId: row.id,
    };
  }

  async safeWalkRecipientData(tx: Prisma.TransactionClient, noticeId: string, recipientUserId: string) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: recipientUserId }, select: { email: true, facilityId: true } });
    if (!user.facilityId) return { recipient: user.email, protectedSnapshotId: null };
    const actor = this.deliveryActor(user.facilityId);
    await this.identities.authorize(tx, user.facilityId, actor, "DELIVERY");
    const row = await this.identities.protectInTransaction(tx, actor, { tenantId: user.facilityId, subjectUserId: recipientUserId, sourceId: noticeId, kind: "NOTIFICATION_SNAPSHOT" }, JSON.stringify({ version: 1, recipient: user.email }));
    return { recipient: "[protected]", protectedSnapshotId: row.id };
  }

  async safeWalkRecipient(snapshotId: string, noticeId: string, recipientUserId: string): Promise<string> {
    const row = await this.prisma.safeWalkNotice.findFirst({ where: { id: noticeId, recipientUserId, protectedSnapshotId: snapshotId } });
    if (!row) throw missing();
    const value = await this.resolve(snapshotId, noticeId, recipientUserId, "NOTIFICATION_SNAPSHOT");
    if (value.version !== 1 || typeof value.recipient !== "string" || !value.recipient.trim()) throw failed();
    return value.recipient;
  }

  private async resolve(
    snapshotId: string,
    sourceId: string,
    subjectUserId: string,
    kind: SnapshotKind,
    tx?: Prisma.TransactionClient,
  ): Promise<Record<string, unknown>> {
    // A reference copied from another outbox row must not unlock its plaintext.
    const row = await (tx ?? this.prisma).protectedIdentifier.findFirst({
      where: { id: snapshotId, sourceId, subjectUserId, kind },
      select: { tenantId: true },
    });
    if (!row) throw missing();
    const expected = { tenantId: row.tenantId, subjectUserId, sourceId, kind };
    const actor = this.deliveryActor(row.tenantId);
    // Replay already owns a transaction and its outbox lock. Keep lookup and audit
    // on that connection; only the masked replay status leaves the outer commit.
    const plaintext = tx
      ? await this.identities.resolveInTransaction(
          tx, actor, row.tenantId, snapshotId, "DELIVERY", sourceId, expected,
        )
      : await this.identities.resolve(
          actor, row.tenantId, snapshotId, "DELIVERY", sourceId, expected,
        );
    try {
      const value: unknown = JSON.parse(plaintext);
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw failed();
      return value as Record<string, unknown>;
    } catch {
      throw markDeliveryFailure(failed(), "PAYLOAD_VALIDATION_FAILED");
    }
  }

  async invitationRecipient(
    snapshotId: string,
    sourceId: string,
    subjectUserId: string,
  ): Promise<string> {
    const value = await this.resolve(
      snapshotId,
      sourceId,
      subjectUserId,
      "INVITATION_SNAPSHOT",
    );
    if (
      value.version !== 1 ||
      typeof value.recipient !== "string" ||
      !value.recipient.trim()
    )
      throw failed();
    return value.recipient;
  }

  async notificationPayload(
    snapshotId: string,
    sourceId: string,
  ): Promise<NotificationPayloadV1> {
    const notification = await this.prisma.incidentNotification.findFirst({
      where: { id: sourceId, protectedSnapshotId: snapshotId },
      select: { incident: { select: { userId: true } } },
    });
    if (!notification) throw missing();
    const value = await this.resolve(
      snapshotId,
      sourceId,
      notification.incident.userId,
      "NOTIFICATION_SNAPSHOT",
    );
    if (value.version !== 1 || !validNotificationPayload(value.payload))
      throw markDeliveryFailure(failed(), "PAYLOAD_VALIDATION_FAILED");
    return value.payload;
  }
}

function validNotificationPayload(
  value: unknown,
): value is NotificationPayloadV1 {
  return (
    isNotificationPayloadV1(value) &&
    ["SMS", "EMAIL", "PUSH", "VOICE", "WHATSAPP"].includes(value.channel) &&
    value.recipient.trim().length > 0 &&
    value.message.trim().length > 0
  );
}
