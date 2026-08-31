import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { ActivateProvisionedUserDto } from './dto/activate-provisioned-user.dto';

/**
 * ONE MESSAGE FOR EVERY FAILURE.
 *
 * Deliberately unlike IncidentAccessTokenService, which reports EXPIRED and
 * REVOKED separately because a family watching a tracking link needs to know
 * which - telling them "this incident ended" when a link merely expired
 * could convince them the emergency is over.
 *
 * Here the caller is unauthenticated and holds nothing but a guess.
 * Distinguishing "unknown token" from "expired token" would confirm that a
 * token once existed, and distinguishing "already activated" would confirm
 * which seats have been claimed.
 */
const ACTIVATION_FAILED = 'This activation link is not valid.';

/**
 * Claims a provisioned operator or resident account.
 *
 * The only unauthenticated write path into User apart from registration. An
 * administrator creates the account in AdminProvisioningService with a random
 * 32-byte token; only its SHA-256 digest is stored. This exchanges the raw
 * token, once, for a password of the operator's choosing.
 */
@Injectable()
export class ActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Same digest AdminProvisioningService uses when it stores the hash.
   *
   * Private for the same reason IncidentAccessTokenService keeps its own
   * hashing private: two call sites computing "the hash of a token" slightly
   * differently is a defect nothing would catch until a real operator could
   * not activate.
   */
  private hashActivationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async activate(dto: ActivateProvisionedUserDto) {
    const tokenHash = this.hashActivationToken(dto.token);

    // Pre-lock lookup, and it decides NOTHING. Its only job is to resolve
    // the user id needed to enter the per-user lock domain. Every condition
    // that matters is re-read under the lock below, because between this
    // read and that one another request may have activated the same seat.
    const candidate = await this.prisma.user.findUnique({
      where: { activationTokenHash: tokenHash },
      select: { id: true },
    });

    if (!candidate) {
      throw new UnauthorizedException(ACTIVATION_FAILED);
    }

    // OUTSIDE THE TRANSACTION, DELIBERATELY. bcrypt at the configured cost
    // is roughly 100ms of CPU. Inside, it would hold both an advisory lock
    // and an open transaction for that whole time, serialising every other
    // write touching this user behind a hash computation.
    const passwordHash = await bcrypt.hash(
      dto.password,
      this.config.getOrThrow<number>('BCRYPT_ROUNDS'),
    );

    const activated = await this.prisma.$transaction(async (tx) => {
      // The same one-argument per-user lock taken by incident activation,
      // lifecycle transitions, journey sessions and resident assignment.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.id}))`;

      // THE RE-READ IS WHAT MAKES ACTIVATION SINGLE-USE. Two simultaneous
      // requests carrying the same token both pass the lookup above, then
      // serialise here. The first nulls activationTokenHash on its way out;
      // the second re-reads, finds it null, and fails the check below.
      // Without this re-read both would write a password and the loser
      // would silently overwrite the winner.
      const user = await tx.user.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          email: true,
          isActive: true,
          role: true,
          accountStatus: true,
          activationTokenHash: true,
          activationExpiresAt: true,
        },
      });

      const now = new Date();

      if (
        !user ||
        !user.isActive ||
        user.accountStatus !== AccountStatus.PENDING_ACTIVATION ||
        // Only institution-provisioned operators and residents may claim
        // activation tokens. Publicly registered USER accounts are already
        // ACTIVE and carry no activation token, so allowing USER here does
        // not create a second registration path.
        (user.role !== UserRole.FACILITY_OPERATOR &&
          user.role !== UserRole.USER) ||
        user.activationTokenHash !== tokenHash ||
        !user.activationExpiresAt ||
        user.activationExpiresAt <= now
      ) {
        throw new UnauthorizedException(ACTIVATION_FAILED);
      }

      // Nulling the hash is the single-use mechanism. The column is unique
      // and nullable, and PostgreSQL permits many NULLs under a unique
      // index, so every activated operator can hold null at once.
      return tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          accountStatus: AccountStatus.ACTIVE,
          activatedAt: now,
          activationTokenHash: null,
          activationExpiresAt: null,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          credentialVersion: true,
          facilityId: true,
          accountStatus: true,
          activatedAt: true,
        },
      });
    });

    // Activation is an authentication ceremony. Once the single-use claim
    // transaction has committed, issue the same session envelope used by
    // registration and login. Token signing deliberately stays outside the
    // transaction and advisory-lock lifetime.
    return this.authService.issueTokens(activated);
  }
}
