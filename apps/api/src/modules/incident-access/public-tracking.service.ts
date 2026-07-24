import { Injectable, Logger } from '@nestjs/common';
import { IncidentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IncidentAccessTokenService } from './incident-access-token.service';
import type { PublicTrackingResponse } from './dto/public-incident-snapshot.dto';

/**
 * Resolves a bearer tracking link to the snapshot its holder may see.
 *
 * Deliberately queries the incident itself rather than widening the token
 * service's include: that would pull the full user record - password hash and
 * all - into memory on every tracking request. Here we select only the two
 * name fields the page needs.
 */
@Injectable()
export class PublicTrackingService {
  private readonly logger = new Logger(PublicTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: IncidentAccessTokenService,
  ) {}

  async getSnapshot(rawToken: string): Promise<PublicTrackingResponse> {
    const resolution = await this.accessTokens.resolve(rawToken);

    if (resolution.status === 'NOT_FOUND') {
      // Nothing is logged about the attempt: the raw token must never reach
      // the logs, and an unknown token tells us nothing worth recording.
      return { state: 'NOT_FOUND', incident: null };
    }

    // Revocation is an explicit access-control decision and outranks
    // everything else, including the incident having closed.
    if (resolution.status === 'REVOKED') {
      return { state: 'REVOKED', incident: null };
    }

    const details = await this.prisma.incident.findUnique({
      where: { id: resolution.token.incidentId },
      select: {
        status: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        resolvedAt: true,
        lastTriggeredAt: true,
        retriggerCount: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });

    if (!details) {
      // A token row exists but its incident does not. The foreign key makes
      // this impossible under normal operation, so if it fires it means real
      // corruption - a deleted row or a bad migration. Log the incident id,
      // never the raw token.
      this.logger.error(
        `Incident ${resolution.token.incidentId} missing for an existing access token.`,
      );
      return { state: 'NOT_FOUND', incident: null };
    }

    // Fall back rather than render "Person:" with a blank name if a user
    // somehow has no name recorded.
    const personName =
      [details.user.firstName, details.user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'An OPA user';

    // Closed is checked BEFORE expiry on purpose. Someone opening an old link
    // benefits far more from learning the emergency ended than from being
    // told only that their link lapsed.
    if (details.status !== IncidentStatus.OPEN) {
      return {
        state: 'INCIDENT_CLOSED',
        incident: {
          personName,
          status: 'RESOLVED',
          triggeredAt: details.createdAt.toISOString(),
          resolvedAt: details.resolvedAt?.toISOString() ?? null,
        },
      };
    }

    if (resolution.status === 'EXPIRED') {
      // Must NOT say the incident ended - it may still be active.
      return { state: 'EXPIRED', incident: null };
    }

    // Access telemetry is recorded only for genuinely valid views, so expired,
    // revoked and unknown links cannot pollute it. This does not extend the
    // token's life - see ADR-008.
    await this.accessTokens.recordAccess(resolution.token.id);

    return {
      state: 'VALID',
      incident: {
        personName,
        status: 'OPEN',
        triggeredAt: details.createdAt.toISOString(),
        location: {
          latitude: Number(details.latitude),
          longitude: Number(details.longitude),
          capturedAt: details.createdAt.toISOString(),
        },
        retriggerCount: details.retriggerCount,
        lastRetriggeredAt:
          details.retriggerCount > 0
            ? (details.lastTriggeredAt?.toISOString() ?? null)
            : null,
      },
    };
  }
}
