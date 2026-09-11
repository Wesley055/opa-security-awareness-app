import { DeliveryLedgerService } from "../notifications/delivery-ledger.service";
import { dispatchWithEvidence } from "../notifications/delivery-dispatch";
import { ProtectedSnapshotsService } from "../protected-identity/protected-snapshots.service";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailProvider } from "../notifications/providers/email.provider";
import {
  prepareIdentityDelivery,
  type IdentityMessage,
} from "./identity-delivery";
import { Interval } from "@nestjs/schedule";
import { AccountStatus, NotificationStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  generateActivationCode,
  hashActivationCredential,
} from "../../shared/security/activation-code";
import { SmsProvider } from "../notifications/providers/sms.provider";

const ACTIVATION_VALIDITY_MS = 24 * 60 * 60 * 1000;
const SINGLE_SMS_GSM7_SEPTETS = 160;

// We deliberately emit only the GSM-7 BASIC alphabet here. Extension-table
// characters are avoided, so every emitted character costs one septet.
const GSM7_BASIC =
  "@Â£$Â¥Ã¨Ã©Ã¹Ã¬Ã²Ã‡\nÃ˜Ã¸\rÃ…Ã¥Î”_Î¦Î“Î›Î©Î Î¨Î£Î˜ÎžÃ†Ã¦ÃŸÃ‰ !\"#Â¤%&'()*+,-./0123456789:;<=>?Â¡ABCDEFGHIJKLMNOPQRSTUVWXYZÃ„Ã–Ã‘ÃœÂ§Â¿abcdefghijklmnopqrstuvwxyzÃ¤Ã¶Ã±Ã¼Ã ";

type ClaimedInvitation = {
  deliveryId: string;
  attemptId: string;
  recipient: string;
  facilityName: string;
  attemptCount: number;
  code: string;
  identityMessage?: IdentityMessage;
  protectedSnapshotId?: string | null;
  subjectUserId?: string;
};

function gsm7BasicSanitize(value: string): string {
  return Array.from(value)
    .map((character) => (GSM7_BASIC.includes(character) ? character : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function fitFacilityName(
  rawFacilityName: string,
  fixedSeptets: number,
): string {
  const fallback = "your estate";
  const sanitized = gsm7BasicSanitize(rawFacilityName);
  const available = SINGLE_SMS_GSM7_SEPTETS - fixedSeptets;

  if (available <= 0) {
    return fallback;
  }

  const candidate = sanitized || fallback;
  if (candidate.length <= available) {
    return candidate;
  }

  const words = candidate.split(" ");
  let fitted = "";

  for (const word of words) {
    const next = fitted ? `${fitted} ${word}` : word;
    if (next.length > available) {
      break;
    }
    fitted = next;
  }

  if (fitted) {
    return fitted;
  }

  // Never emit a broken partial estate name. If even the first word cannot
  // fit, prefer the short neutral description.
  return fallback.length <= available ? fallback : "";
}

function buildInvitationMessage(facilityName: string, code: string): string {
  const displayCode = `${code.slice(0, 4)}-${code.slice(4)}`;
  const prefix = "OPA: ";
  const afterName =
    " has added you to emergency protection.\n\n" +
    `Your code: ${displayCode}\n\n` +
    "Open OPA and enter this code. Expires in 24 hours.";

  const fittedName = fitFacilityName(
    facilityName,
    prefix.length + afterName.length,
  );

  return `${prefix}${fittedName}${afterName}`;
}

@Injectable()
export class InvitationDeliveryWorker {
  private readonly logger = new Logger(InvitationDeliveryWorker.name);
  private running = false;
  private readonly batchSize = Number(
    process.env.INVITATION_DISPATCH_BATCH_SIZE ?? 25,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsProvider: SmsProvider,
    private readonly emailProvider: EmailProvider,
    private readonly config: ConfigService,
    private readonly snapshots: ProtectedSnapshotsService,
    private readonly ledger: DeliveryLedgerService = new DeliveryLedgerService(
      prisma,
    ),
  ) {}

  @Interval(2000)
  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.ledger.recoverStale();

      let processed = 0;
      for (let i = 0; i < this.batchSize; i += 1) {
        const claimed = await this.claimNextDue();
        if (!claimed) {
          break;
        }

        await this.dispatch(claimed);
        processed += 1;
      }

      if (processed > 0) {
        this.logger.log(
          `Invitation worker: processed ${processed} delivery attempt(s)`,
        );
      }
    } catch {
      this.logger.error("Invitation delivery tick failed.");
    } finally {
      this.running = false;
    }
  }

  /**
   * Claim one due row and mint its credential in the SAME transaction.
   * Plaintext exists only in worker memory.
   */
  private async claimNextDue(): Promise<ClaimedInvitation | null> {
    const now = new Date();
    let claimedResult: ClaimedInvitation | null = null;

    await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.accountInvitationDelivery.findFirst({
        where: {
          status: NotificationStatus.QUEUED,
          nextAttemptAt: { lte: now },
          attemptCount: { lt: 5 },
        },
        orderBy: [{ nextAttemptAt: "asc" }, { queuedAt: "asc" }],
      });

      if (!candidate) {
        return;
      }

      if (candidate.enrollmentId) {
        await tx.$queryRaw`SELECT id FROM "EnrollmentRequest" WHERE id = ${candidate.enrollmentId}::uuid FOR UPDATE`;
      }

      const attempt = await this.ledger.claim(tx, {
        kind: "invitation",
        id: candidate.id,
      });
      if (!attempt) return;

      const delivery = await tx.accountInvitationDelivery.findUnique({
        where: { id: candidate.id },
        include: {
          facility: { select: { name: true, isActive: true } },
          user: {
            select: {
              id: true,
              role: true,
              isActive: true,
              accountStatus: true,
              facilityId: true,
            },
          },
        },
      });

      if (!delivery) {
        return;
      }

      if (delivery.purpose && delivery.purpose !== "LEGACY_INVITATION") {
        const identityMessage = await prepareIdentityDelivery(
          tx,
          delivery,
          this.config,
        );
        if (!identityMessage) {
          await tx.accountInvitationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: NotificationStatus.CANCELLED,
              deliveryStatus: "FAILED",
              failureCategory: "REJECTED",
              failedAt: now,
              lastError: "Delivery no longer eligible.",
            },
          });
          await this.ledger.rejectInTransaction(
            tx,
            attempt,
            "RECIPIENT_INELIGIBLE",
          );
          return;
        }
        claimedResult = {
          deliveryId: delivery.id,
          attemptId: attempt.id,
          recipient: identityMessage.recipient,
          facilityName: "",
          attemptCount: delivery.attemptCount,
          code: "",
          identityMessage,
        };
        return;
      }
      if (
        !delivery.user ||
        !delivery.facility ||
        !delivery.userId ||
        !delivery.facility.isActive ||
        !delivery.user.isActive ||
        delivery.user.role !== UserRole.USER ||
        delivery.user.accountStatus !== AccountStatus.PENDING_ACTIVATION ||
        delivery.user.facilityId !== delivery.facilityId
      ) {
        await tx.accountInvitationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: NotificationStatus.FAILED,
            deliveryStatus: "FAILED",
            failureCategory: "REJECTED",
            failedAt: now,
            lastError: "Resident is no longer eligible for activation.",
          },
        });
        await this.ledger.rejectInTransaction(
          tx,
          attempt,
          "RECIPIENT_INELIGIBLE",
        );
        return;
      }

      const code = generateActivationCode();
      const activationExpiresAt = new Date(
        now.getTime() + ACTIVATION_VALIDITY_MS,
      );

      await tx.user.update({
        where: { id: delivery.userId },
        data: {
          activationTokenHash: hashActivationCredential(code),
          activationExpiresAt,
        },
      });

      claimedResult = {
        deliveryId: delivery.id,
        attemptId: attempt.id,
        recipient: delivery.recipient,
        protectedSnapshotId: delivery.protectedSnapshotId,
        subjectUserId: delivery.userId,
        facilityName: delivery.facility.name,
        attemptCount: delivery.attemptCount,
        code,
      };
    });

    return claimedResult;
  }

  private async dispatch(claimed: ClaimedInvitation): Promise<void> {
    const provider =
      claimed.identityMessage?.channel === "EMAIL"
        ? this.emailProvider
        : this.smsProvider;
    let request;
    try {
      const recipient = claimed.protectedSnapshotId
        ? await this.snapshots.invitationRecipient(
            claimed.protectedSnapshotId,
            claimed.deliveryId,
            claimed.subjectUserId!,
          )
        : claimed.recipient;
      request = claimed.identityMessage ?? {
        recipient,
        message: buildInvitationMessage(claimed.facilityName, claimed.code),
      };
    } catch {
      await this.ledger.complete(claimed.attemptId, {
        success: false,
        provider: provider.providerName,
        failureCategory: "INTERNAL_ERROR",
        retryable: false,
      });
      return;
    }
    await dispatchWithEvidence(
      provider.providerName,
      () => provider.send(request),
      (response) => this.ledger.complete(claimed.attemptId, response),
    );
  }
}
