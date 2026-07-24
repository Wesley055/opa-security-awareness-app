import { Injectable, Logger } from '@nestjs/common';
import { IncidentStatus, TrackingAccessScope } from '@prisma/client';
import type { Incident, IncidentAccessToken, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 128 bits of entropy, base64url encoded (~22 characters).
 *
 * Short enough to keep an SMS tracking link inside one segment, and
 * computationally infeasible to guess. The token is also short-lived and
 * revocable, so the shorter length carries far less risk than it would for a
 * long-lived secret.
 */
const TOKEN_BYTES = 16;

/** Initial validity. Renewed server-side while the incident is OPEN. */
const INITIAL_VALIDITY_MS = 6 * 60 * 60 * 1000;

/** Hard ceiling from issuance. Never extended, for any reason. */
const ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Only renew tokens within this window of expiring. Renewing every live
 * token on every tick is pointless write load.
 */
const RENEWAL_WINDOW_MS = 60 * 60 * 1000;

export type TokenIssueResult = {
  /** The RAW token. Returned exactly once, for the outbound link. Never stored. */
  token: string;
  record: IncidentAccessToken;
};

/** A token row with its incident already loaded, so callers need no second query. */
export type TokenWithIncident = IncidentAccessToken & { incident: Incident };

export type TokenResolution =
  | { status: 'VALID'; token: TokenWithIncident }
  | { status: 'NOT_FOUND' }
  | { status: 'REVOKED'; token: TokenWithIncident }
  | { status: 'EXPIRED'; token: TokenWithIncident };

/**
 * Issues and resolves capability tokens for incident tracking links.
 *
 * Only the SHA-256 hash of a token is persisted. The raw value exists solely
 * in the message sent to the recipient, so a database compromise does not
 * hand an attacker working tracking links.
 *
 * See docs/architecture/decision-log.md ADR-008.
 */
@Injectable()
export class IncidentAccessTokenService {
  private readonly logger = new Logger(IncidentAccessTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * SHA-256 hex digest. Deterministic, so a raw token can be looked up.
   *
   * Private on purpose: if another service needs to hash a tracking token it
   * should call through this service rather than reimplementing the algorithm
   * slightly differently.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Issue a new tracking token for an incident.
   *
   * The raw token is returned ONCE and never persisted. If the caller loses
   * it, a new token must be issued - it cannot be recovered.
   */
  async issue(
    incidentId: string,
    scope: TrackingAccessScope = TrackingAccessScope.FAMILY_BEARER,
    tx?: Prisma.TransactionClient,
  ): Promise<TokenIssueResult> {
    const db = tx ?? this.prisma;
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const now = Date.now();

    const record = await db.incidentAccessToken.create({
      data: {
        incidentId,
        tokenHash: this.hashToken(token),
        scope,
        expiresAt: new Date(now + INITIAL_VALIDITY_MS),
        absoluteExpiry: new Date(now + ABSOLUTE_LIFETIME_MS),
      },
    });

    return { token, record };
  }

  /**
   * Resolve a raw token to its record, reporting WHY it failed.
   *
   * The distinction matters: telling a family "this link expired, the
   * incident may still be active" is very different from "this incident has
   * ended". Collapsing both into a 404 could tell someone the emergency is
   * over while their relative is still missing.
   */
  async resolve(token: string): Promise<TokenResolution> {
    const record = await this.prisma.incidentAccessToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { incident: true },
    });

    if (!record) {
      return { status: 'NOT_FOUND' };
    }
    if (record.revokedAt) {
      return { status: 'REVOKED', token: record };
    }

    const now = new Date();
    if (record.expiresAt <= now || record.absoluteExpiry <= now) {
      return { status: 'EXPIRED', token: record };
    }

    return { status: 'VALID', token: record };
  }

  /**
   * Record that a valid token was used.
   *
   * Deliberately does NOT touch expiresAt. Renewal is driven by incident
   * state, server-side. If viewing extended validity, anyone holding a
   * forwarded link could keep it alive indefinitely by reopening it - which
   * is exactly what the expiry exists to prevent.
   */
  async recordAccess(tokenId: string): Promise<void> {
    await this.prisma.incidentAccessToken.update({
      where: { id: tokenId },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    });
  }

  /** Revoke a single token immediately. */
  async revoke(tokenId: string): Promise<void> {
    await this.prisma.incidentAccessToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoke every live token for an incident. Called when an incident closes:
   * live tracking must stop the moment the emergency is over.
   */
  async revokeAllForIncident(incidentId: string): Promise<number> {
    const result = await this.prisma.incidentAccessToken.updateMany({
      where: { incidentId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count > 0) {
      this.logger.log(
        `Revoked ${result.count} tracking token(s) for incident ${incidentId}.`,
      );
    }
    return result.count;
  }

  /**
   * Extend tokens whose incidents are still OPEN.
   *
   * Runs server-side on a schedule. Respects the absolute ceiling: a token
   * past ABSOLUTE_LIFETIME_MS is never extended, even for an active incident.
   * When that happens the family loses access with no self-service recovery
   * until OTP re-issue is built - a documented, accepted consequence.
   *
   * Only tokens within RENEWAL_WINDOW_MS of expiring are touched, so this
   * does not rewrite every live token on every tick.
   */
  async renewEligibleTokens(now: Date = new Date()): Promise<number> {
    const candidates = await this.prisma.incidentAccessToken.findMany({
      where: {
        revokedAt: null,
        absoluteExpiry: { gt: now },
        expiresAt: { lte: new Date(now.getTime() + RENEWAL_WINDOW_MS) },
        incident: { status: IncidentStatus.OPEN },
      },
      select: { id: true, expiresAt: true, absoluteExpiry: true },
    });

    if (candidates.length === 0) {
      return 0;
    }

    const proposed = new Date(now.getTime() + INITIAL_VALIDITY_MS);

    const updates = candidates.flatMap((candidate) => {
      // Never extend past the absolute ceiling.
      const next =
        proposed > candidate.absoluteExpiry
          ? candidate.absoluteExpiry
          : proposed;

      // A token already pinned to its ceiling would otherwise be rewritten to
      // the same value on every tick, and counted as a renewal that did not
      // happen.
      if (next <= candidate.expiresAt) {
        return [];
      }

      return [
        this.prisma.incidentAccessToken.update({
          where: { id: candidate.id },
          data: { expiresAt: next },
        }),
      ];
    });

    if (updates.length === 0) {
      return 0;
    }

    // One transaction so a crash mid-run cannot leave half the batch renewed.
    await this.prisma.$transaction(updates);

    this.logger.debug(`Renewed ${updates.length} incident access token(s).`);
    return updates.length;
  }
}
