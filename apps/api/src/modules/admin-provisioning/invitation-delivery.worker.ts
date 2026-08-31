import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AccountStatus,
  NotificationStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateActivationCode,
  hashActivationCredential,
} from '../../shared/security/activation-code';
import { SmsProvider } from '../notifications/providers/sms.provider';

const ACTIVATION_VALIDITY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const STALE_SENDING_MS = 5 * 60 * 1000;
const SINGLE_SMS_GSM7_SEPTETS = 160;
const RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
] as const;

// We deliberately emit only the GSM-7 BASIC alphabet here. Extension-table
// characters are avoided, so every emitted character costs one septet.
const GSM7_BASIC =
  "@Â£$Â¥Ã¨Ã©Ã¹Ã¬Ã²Ã‡\nÃ˜Ã¸\rÃ…Ã¥Î”_Î¦Î“Î›Î©Î Î¨Î£Î˜ÎžÃ†Ã¦ÃŸÃ‰ !\"#Â¤%&'()*+,-./0123456789:;<=>?Â¡ABCDEFGHIJKLMNOPQRSTUVWXYZÃ„Ã–Ã‘ÃœÂ§Â¿abcdefghijklmnopqrstuvwxyzÃ¤Ã¶Ã±Ã¼Ã ";

type ClaimedInvitation = {
  deliveryId: string;
  recipient: string;
  facilityName: string;
  attemptCount: number;
  code: string;
};

function gsm7BasicSanitize(value: string): string {
  return Array.from(value)
    .map((character) => (GSM7_BASIC.includes(character) ? character : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function fitFacilityName(
  rawFacilityName: string,
  fixedSeptets: number,
): string {
  const fallback = 'your estate';
  const sanitized = gsm7BasicSanitize(rawFacilityName);
  const available = SINGLE_SMS_GSM7_SEPTETS - fixedSeptets;

  if (available <= 0) {
    return fallback;
  }

  const candidate = sanitized || fallback;
  if (candidate.length <= available) {
    return candidate;
  }

  const words = candidate.split(' ');
  let fitted = '';

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
  return fallback.length <= available ? fallback : '';
}

function buildInvitationMessage(
  facilityName: string,
  code: string,
): string {
  const displayCode = `${code.slice(0, 4)}-${code.slice(4)}`;
  const prefix = 'OPA: ';
  const afterName =
    ' has added you to emergency protection.\n\n' +
    `Your code: ${displayCode}\n\n` +
    'Open OPA and enter this code. Expires in 24 hours.';

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
  ) {}

  @Interval(2000)
  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.recoverStaleSending();

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
    } catch (error) {
      this.logger.error(
        'Invitation delivery tick failed.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * A process can die after claiming a row. Requeue stale ownership so the
   * invitation is not stranded forever. A later claim rotates the activation
   * code before sending again.
   *
   * If the previous process died after provider acceptance but before SENT
   * was recorded, a retry can produce a second SMS. Transport is therefore
   * at-least-once, not exactly-once.
   */
  private async recoverStaleSending(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_SENDING_MS);

    await this.prisma.accountInvitationDelivery.updateMany({
      where: {
        status: NotificationStatus.SENDING,
        lastAttemptAt: { lte: staleBefore },
      },
      data: {
        status: NotificationStatus.QUEUED,
        nextAttemptAt: new Date(),
        lastError: 'Recovered stale sending attempt.',
      },
    });
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
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { queuedAt: 'asc' }],
      });

      if (!candidate) {
        return;
      }

      const claim = await tx.accountInvitationDelivery.updateMany({
        where: {
          id: candidate.id,
          status: NotificationStatus.QUEUED,
          nextAttemptAt: { lte: now },
        },
        data: {
          status: NotificationStatus.SENDING,
          attemptCount: { increment: 1 },
          lastAttemptAt: now,
          failedAt: null,
          lastError: null,
        },
      });

      if (claim.count !== 1) {
        return;
      }

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

      if (
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
            failedAt: now,
            lastError: 'Resident is no longer eligible for activation.',
          },
        });
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
        recipient: delivery.recipient,
        facilityName: delivery.facility.name,
        attemptCount: delivery.attemptCount,
        code,
      };
    });

    return claimedResult;
  }

  private async dispatch(claimed: ClaimedInvitation): Promise<void> {
    const response = await this.smsProvider.send({
      recipient: claimed.recipient,
      message: buildInvitationMessage(claimed.facilityName, claimed.code),
    });

    if (response.success) {
      await this.prisma.accountInvitationDelivery.update({
        where: { id: claimed.deliveryId },
        data: {
          status: NotificationStatus.SENT,
          provider: response.provider,
          providerMessageId: response.messageId,
          sentAt: new Date(),
          failedAt: null,
          lastError: null,
        },
      });
      return;
    }

    const error = response.error ?? 'SMS provider did not accept invitation.';
    const terminal = this.isTerminalFailure(error);
    const exhausted = claimed.attemptCount >= MAX_ATTEMPTS;

    if (terminal || exhausted) {
      await this.prisma.accountInvitationDelivery.update({
        where: { id: claimed.deliveryId },
        data: {
          status: NotificationStatus.FAILED,
          provider: response.provider,
          providerMessageId: response.messageId,
          failedAt: new Date(),
          lastError: error,
        },
      });
      return;
    }

    const retryIndex = Math.min(
      claimed.attemptCount - 1,
      RETRY_DELAYS_MS.length - 1,
    );
    const delay = RETRY_DELAYS_MS[retryIndex] ?? RETRY_DELAYS_MS[0];

    await this.prisma.accountInvitationDelivery.update({
      where: { id: claimed.deliveryId },
      data: {
        status: NotificationStatus.QUEUED,
        provider: response.provider,
        providerMessageId: response.messageId,
        nextAttemptAt: new Date(Date.now() + delay),
        failedAt: null,
        lastError: error,
      },
    });
  }

  private isTerminalFailure(error: string): boolean {
    return (
      error.includes('InvalidPhoneNumber') ||
      error.includes('UserInBlacklist')
    );
  }
}