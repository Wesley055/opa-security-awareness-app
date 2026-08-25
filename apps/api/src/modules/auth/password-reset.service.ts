import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailProvider } from '../notifications/providers/email.provider';
import type { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import type { RequestPasswordResetDto } from './dto/request-password-reset.dto';

const GENERIC_REQUEST_RESPONSE =
  'If an eligible OPA account exists for that email, password reset instructions have been sent.';

const RESET_FAILED = 'This password reset token is invalid or expired.';
const RESET_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailProvider: EmailProvider,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async requestReset(dto: RequestPasswordResetDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        isActive: true,
        accountStatus: true,
        passwordHash: true,
      },
    });

    // Non-enumerating response: unauthenticated callers learn nothing about
    // whether an account exists, is suspended, or is pending activation.
    if (
      !user ||
      !user.isActive ||
      user.accountStatus !== AccountStatus.ACTIVE ||
      !user.passwordHash
    ) {
      return { message: GENERIC_REQUEST_RESPONSE };
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;

      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
    });

    const result = await this.emailProvider.send({
      recipient: user.email,
      subject: 'Reset your OPA password',
      message: [
        'A password reset was requested for your OPA account.',
        '',
        'Open the OPA app and choose "Forgot password?".',
        'Then choose "I have a reset token" and paste the secure token below.',
        '',
        rawToken,
        '',
        'This token expires in 30 minutes and can be used only once.',
        'If you did not request this reset, ignore this email.',
      ].join('\n'),
    });

    if (!result.success) {
      await this.prisma.passwordResetToken.updateMany({
        where: { tokenHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      // Deliberately omit token and recipient.
      this.logger.error('Password reset email delivery failed.');
    }

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