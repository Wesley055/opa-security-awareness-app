import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { protectIdentity } from '../../shared/security/enrollment-identity';
import type { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import type { RequestPasswordResetDto } from './dto/request-password-reset.dto';

const GENERIC_REQUEST_RESPONSE =
  'If an eligible OPA account exists for that email, password reset instructions will be sent.';

const RESET_FAILED = 'This password reset token is invalid or expired.';


@Injectable()
export class PasswordResetService {


  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async requestReset(dto: RequestPasswordResetDto) {
    await this.prisma.accountInvitationDelivery.create({ data: {
      purpose: 'PASSWORD_RESET', channel: 'EMAIL', recipient: '', status: 'QUEUED',
      requestCiphertext: protectIdentity(this.config, { email: dto.email.trim().toLowerCase() }),
    } });
    return { message: GENERIC_REQUEST_RESPONSE };
  }

  async confirmReset(dto: ConfirmPasswordResetDto) {
    const tokenHash = this.hashToken(dto.token.trim());

    // Pre-lock lookup resolves only the per-user lock key. It authorizes nothing.
    const candidate = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    });

    if (!candidate) {
      throw new BadRequestException(RESET_FAILED);
    }

    // Expensive bcrypt work stays outside the transaction/lock.
    const passwordHash = await bcrypt.hash(
      dto.password,
      this.config.getOrThrow<number>('BCRYPT_ROUNDS'),
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.userId}))`;

      const reset = await tx.passwordResetToken.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          userId: true,
          tokenHash: true,
          expiresAt: true,
          consumedAt: true,
          user: {
            select: {
              id: true,
              isActive: true,
              accountStatus: true,
            },
          },
        },
      });

      const now = new Date();

      if (
        !reset ||
        reset.tokenHash !== tokenHash ||
        reset.consumedAt ||
        reset.expiresAt <= now ||
        !reset.user.isActive ||
        reset.user.accountStatus !== AccountStatus.ACTIVE
      ) {
        throw new BadRequestException(RESET_FAILED);
      }

      await tx.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash,
          credentialVersion: { increment: 1 },
        },
      });

      // Consume all outstanding reset tokens for this account atomically.
      await tx.passwordResetToken.updateMany({
        where: { userId: reset.userId, consumedAt: null },
        data: { consumedAt: now },
      });

      return {
        message:
          'Your OPA password has been reset. Sign in again with your new password.',
      };
    });
  }
}