import {
  BadRequestException,
  Controller,
  HttpCode,
  Injectable,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { Webhook } from "standardwebhooks";
import {
  DeliveryFailureCategory,
  DeliveryStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { providerIdentity } from "./delivery-policy";

type Receipt = {
  provider: string;
  accountScope: string;
  eventId: string;
  messageId: string;
  status: DeliveryStatus;
  failureCategory: DeliveryFailureCategory | null;
  eventType: string;
  occurredAt: Date;
};

@Injectable()
export class ResendReceiptVerifier {
  verify(raw: Buffer | undefined, headers: Request["headers"]): Receipt | null {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret)
      throw new ServiceUnavailableException(
        "Delivery receipt verification is not configured",
      );
    if (!raw || raw.length > 65_536)
      throw new BadRequestException("Invalid delivery receipt");
    const id = headers["svix-id"];
    const timestamp = headers["svix-timestamp"];
    const signature = headers["svix-signature"];
    if (
      typeof id !== "string" ||
      id.length > 256 ||
      typeof timestamp !== "string" ||
      !/^\d{10,12}$/.test(timestamp) ||
      typeof signature !== "string" ||
      signature.length > 2048
    )
      throw new UnauthorizedException("Invalid delivery receipt signature");
    let value: unknown;
    try {
      // Svix verifies raw bytes, constant-time signatures and a five-minute
      // timestamp tolerance. Its envelope timestamp differs from event time.
      value = new Webhook(secret).verify(raw.toString("utf8"), {
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": signature,
      });
    } catch {
      throw new UnauthorizedException("Invalid delivery receipt signature");
    }
    if (!value || typeof value !== "object")
      throw new BadRequestException("Invalid delivery receipt");
    const event = value as {
      type?: unknown;
      created_at?: unknown;
      data?: { email_id?: unknown };
    };
    if (typeof event.type !== "string" || event.type.length > 64)
      throw new BadRequestException("Invalid delivery receipt");
    const mapping: Record<
      string,
      {
        status: DeliveryStatus;
        failureCategory: DeliveryFailureCategory | null;
      }
    > = {
      "email.sent": { status: "PROVIDER_ACCEPTED", failureCategory: null },
      "email.delivered": { status: "DELIVERED", failureCategory: null },
      "email.bounced": { status: "FAILED", failureCategory: "REJECTED" },
      "email.failed": {
        status: "FAILED",
        failureCategory: "UNKNOWN_PROVIDER_ERROR",
      },
      "email.delivery_delayed": { status: "UNKNOWN", failureCategory: null },
    };
    const outcome = mapping[event.type];
    // Open/click events are deliberately outside this delivery contract.
    if (!outcome) return null;
    const messageId = event.data?.email_id;
    const occurredAt =
      typeof event.created_at === "string"
        ? new Date(event.created_at)
        : new Date(NaN);
    if (
      typeof messageId !== "string" ||
      !messageId ||
      messageId.length > 256 ||
      !Number.isFinite(occurredAt.getTime()) ||
      occurredAt.getTime() > Date.now() + 300_000
    )
      throw new BadRequestException("Invalid delivery receipt");
    return {
      ...providerIdentity("EMAIL"),
      eventId: id,
      messageId,
      eventType: event.type,
      occurredAt,
      ...outcome,
    };
  }
}

@Controller("notifications/provider-receipts")
export class DeliveryReceiptController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verifier: ResendReceiptVerifier,
  ) {}

  // Africa's Talking SMS has no verified signing contract in this integration.
  // Never ingest a claimed DLR into the authenticated receipt inbox. A known
  // message ID, provider URL, API-key-looking header or timestamp is not proof.
  @Post("africastalking")
  africastalking(): never {
    throw new UnauthorizedException("SMS receipt authentication unavailable");
  }

  @Post("resend")
  @HttpCode(200)
  async resend(@Req() request: RawBodyRequest<Request>) {
    const receipt = this.verifier.verify(request.rawBody, request.headers);
    if (!receipt) return { received: true };
    try {
      await this.prisma.providerDeliveryReceipt.create({ data: receipt });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        // Do not leak ORM statements or request content to the exception logger.
        throw new ServiceUnavailableException(
          "Delivery receipt persistence unavailable",
        );
      }
      const prior = await this.prisma.providerDeliveryReceipt.findUnique({
        where: {
          provider_accountScope_eventId: {
            provider: receipt.provider,
            accountScope: receipt.accountScope,
            eventId: receipt.eventId,
          },
        },
      });
      if (
        !prior ||
        prior.messageId !== receipt.messageId ||
        prior.eventType !== receipt.eventType ||
        prior.occurredAt.getTime() !== receipt.occurredAt.getTime()
      )
        throw new BadRequestException("Conflicting delivery receipt identity");
    }
    // ACK only after durable insertion. Unknown references remain in the
    // normalized inbox and are reconciled by the bounded background worker.
    return { received: true };
  }
}
