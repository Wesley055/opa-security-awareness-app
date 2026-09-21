import { Logger } from "@nestjs/common";
import { DELIVERY_WORKER_ID, deliveryDiagnostic, markDeliveryFailure } from "./delivery-diagnostics";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { ProtectedSnapshotsService } from "../protected-identity/protected-snapshots.service";
import { Optional } from "@nestjs/common";
import { dispatchWithEvidence } from "./delivery-dispatch";
import { DeliveryLedgerService } from "./delivery-ledger.service";
import { BadRequestException, Injectable } from "@nestjs/common";
import {
  NotificationChannel as PrismaNotificationChannel,
  NotificationStatus,
} from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import {
  buildNotificationPayload,
  isNotificationPayloadV1,
} from "./notification-payload";
import {
  NotificationChannel,
  SendNotificationDto,
} from "./dto/send-notification.dto";
import { EmailProvider } from "./providers/email.provider";
import type {
  NotificationProvider,
  NotificationResponse,
} from "./providers/notification-provider.interface";
import { PushProvider } from "./providers/push.provider";
import { SmsProvider } from "./providers/sms.provider";
import { VoiceProvider } from "./providers/voice.provider";
import { WhatsAppProvider } from "./providers/whatsapp.provider";

@Injectable()
export class NotificationService {
  private readonly deliveryLogger = new Logger("ProtectedDelivery");
  private readonly providers: Record<NotificationChannel, NotificationProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsProvider: SmsProvider,
    private readonly whatsAppProvider: WhatsAppProvider,
    private readonly pushProvider: PushProvider,
    private readonly emailProvider: EmailProvider,
    private readonly voiceProvider: VoiceProvider,
    @Optional() private readonly protectedSnapshots?: ProtectedSnapshotsService,
    private readonly ledger: DeliveryLedgerService = new DeliveryLedgerService(
      prisma,
    ),
  ) {
    this.providers = {
      [NotificationChannel.SMS]: this.smsProvider,
      [NotificationChannel.WHATSAPP]: this.whatsAppProvider,
      [NotificationChannel.PUSH]: this.pushProvider,
      [NotificationChannel.EMAIL]: this.emailProvider,
      [NotificationChannel.VOICE]: this.voiceProvider,
    };
  }

  async queueMany(
    tx: Prisma.TransactionClient,
    args: Prisma.IncidentNotificationCreateManyArgs,
  ) {
    const values = Array.isArray(args.data) ? args.data : [args.data];
    if (!this.protectedSnapshots)
      throw new BadRequestException("Protected outbox unavailable.");
    const data = [];
    for (const value of values)
      data.push(await this.protectedSnapshots.notificationData(tx, value));
    return tx.incidentNotification.createMany({ ...args, data });
  }

  async send(dto: SendNotificationDto): Promise<NotificationResponse> {
    const provider = this.providers[dto.channel];

    if (!provider) {
      throw new BadRequestException(
        `Unsupported notification channel: ${dto.channel}`,
      );
    }

    const recipient = dto.recipient.trim();
    const message = dto.message.trim();

    if (!recipient) {
      throw new BadRequestException("Notification recipient cannot be empty.");
    }

    if (!message) {
      throw new BadRequestException("Notification message cannot be empty.");
    }

    return provider.send({
      recipient,
      subject: dto.subject?.trim(),
      message,
    });
  }

  async sendEmergencyAlert(params: {
    notificationId?: string;
    incidentId: string;
    contactId?: string;
    contactName: string;
    contactType: string;
    recipient: string;
    channel: NotificationChannel;
    personName: string;
    location: string;
    trackingUrl: string;
  }): Promise<NotificationResponse> {
    const notification = params.notificationId
      ? { id: params.notificationId }
      : await this.prisma.$transaction(async (tx) => {
          const id = randomUUID();
          await this.queueMany(tx, {
            data: {
              id,
              incidentId: params.incidentId,
              contactId: params.contactId,
              contactName: params.contactName.trim(),
              contactType: params.contactType.trim(),
              recipient: params.recipient.trim(),
              channel: this.toPrismaChannel(params.channel),
              status: NotificationStatus.QUEUED,
              payload: buildNotificationPayload(params),
            },
          });
          return { id };
        });
    return (
      (await this.dispatchNotification(notification.id)) ?? {
        success: false,
        provider: "OPA",
        error: "Notification was not claimable",
        failureCategory: "INTERNAL_ERROR",
        retryable: false,
      }
    );
  }

  private toPrismaChannel(
    channel: NotificationChannel,
  ): PrismaNotificationChannel {
    switch (channel) {
      case NotificationChannel.SMS:
        return PrismaNotificationChannel.SMS;

      case NotificationChannel.WHATSAPP:
        return PrismaNotificationChannel.WHATSAPP;

      case NotificationChannel.PUSH:
        return PrismaNotificationChannel.PUSH;

      case NotificationChannel.EMAIL:
        return PrismaNotificationChannel.EMAIL;

      case NotificationChannel.VOICE:
        return PrismaNotificationChannel.VOICE;

      default:
        throw new BadRequestException(
          `Unsupported notification channel: ${channel}`,
        );
    }
  }

  /** The durable claim and attempt identity fence every provider send. */
  async dispatchNotification(
    notificationId: string,
  ): Promise<NotificationResponse | null> {
    const notification = await this.prisma.incidentNotification.findUnique({
      where: { id: notificationId },
      include: { incident: { select: { facilityId: true } } },
    });
    let durablePayload: unknown = notification?.payload;
    if (notification?.protectedSnapshotId) {
      try {
        if (!this.protectedSnapshots) throw markDeliveryFailure(new Error(), "DELIVERY_ACTOR_UNAVAILABLE");
        durablePayload = await this.protectedSnapshots.notificationPayload(
          notification.protectedSnapshotId,
          notification.id,
        );
      } catch (error) {
        // Resolve (including committed audit) BEFORE claiming. An unready process
        // leaves durable work untouched for a ready worker; never sends plaintext fallback.
        this.deliveryLogger.warn(JSON.stringify({ event: "protected_delivery_deferred",
          notificationId, workerId: DELIVERY_WORKER_ID, stage: "PRE_PROVIDER",
          diagnostic: deliveryDiagnostic(error, "SNAPSHOT_RESOLUTION_FAILED") }));
        return null;
      }
    }
    // Resolution does not authorize sending. The existing atomic claim is still
    // the only send fence; competing ready workers can resolve but only one sends.
    const attempt = await this.ledger.claimIncident(notificationId);
    if (!attempt) return null;
    let result: NotificationResponse;
    if (
      !notification ||
      (notification.incident?.facilityId &&
        !notification.protectedSnapshotId) ||
      !isNotificationPayloadV1(durablePayload) ||
      notification.channel !== durablePayload.channel ||
      (!notification.protectedSnapshotId &&
        notification.recipient.trim() !== durablePayload.recipient.trim()) ||
      !durablePayload.recipient.trim() ||
      !durablePayload.message.trim()
    ) {
      result = {
        success: false,
        provider: attempt.provider,
        failureCategory: "INTERNAL_ERROR",
        stage: "PRE_PROVIDER",
        diagnostic: "PAYLOAD_VALIDATION_FAILED",
        retryable: false,
      };
    } else {
      const payload = durablePayload;
      return dispatchWithEvidence(
        attempt.provider,
        () =>
          this.send({
            channel: payload.channel,
            recipient: payload.recipient,
            subject: payload.subject,
            message: payload.message,
          }),
        (response) => this.ledger.complete(attempt.id, response),
      );
    }
    // Persistence failures propagate. Never turn a failed database write into
    // a claim that the provider rejected a message it may have accepted.
    await this.ledger.complete(attempt.id, result);
    return result;
  }
}
