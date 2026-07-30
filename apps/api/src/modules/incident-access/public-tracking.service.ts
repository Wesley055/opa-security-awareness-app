import { Injectable, Logger } from '@nestjs/common';
import { IncidentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IncidentAccessTokenService } from './incident-access-token.service';
import type { PublicTrackingResponse } from './dto/public-incident-snapshot.dto';
import { deriveFixOrigin, deriveTrackingState } from './tracking-state';

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
        // Nested rather than a second query: one round trip, and the
        // newest-fix ordering is index-backed by
        // @@index([journeySessionId, receivedAt(sort: Desc)]).
        journeySession: {
          select: {
            status: true,
            lastFixReceivedAt: true,
            fixes: {
              take: 1,
              // THE TIE-BREAK IS REQUIRED, NOT COSMETIC.
              //
              // insertFixes stamps every fix in one batch with a single
              // receivedAt - date_trunc('milliseconds', now()) captured once
              // per call - so receivedAt is NOT unique, and ordering by it
              // alone is ambiguous the moment a batch carries more than one
              // fix. Postgres may then return either row.
              //
              // Until 29 July 2026 every batch carried exactly one fix, so
              // the ambiguity was unreachable. The mobile tracker's 15s
              // flush against its 10s capture now produces multi-fix
              // batches routinely.
              //
              // sequence is the CORRECT second key, not an arbitrary one:
              // insertFixes sorts a batch by recordedAt before assigning
              // sequence numbers, so within a tied receivedAt group the
              // highest sequence is the latest real capture. The tie-break
              // recovers true recency rather than merely being predictable.
              //
              // The index above still serves the leading key. Ordering
              // within a tied group is resolved after it, and a group is at
              // most one batch, so at most 200 rows.
              orderBy: [{ receivedAt: 'desc' }, { sequence: 'desc' }],
              select: {
                latitude: true,
                longitude: true,
                recordedAt: true,
                source: true,
              },
            },
          },
        },
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

    const now = new Date();
    const session = details.journeySession;
    const newestFix = session?.fixes[0];

    // Redaction nulls the coordinates deliberately (they are the erasure
    // mechanism), so a redacted fix must NOT overwrite the origin with
    // nulls. Falling back to the incident row is the honest answer.
    const usableFix =
      newestFix !== undefined &&
      newestFix.latitude !== null &&
      newestFix.longitude !== null
        ? newestFix
        : undefined;

    const location =
      usableFix !== undefined
        ? {
            latitude: Number(usableFix.latitude),
            longitude: Number(usableFix.longitude),
            capturedAt: usableFix.recordedAt.toISOString(),
            origin: deriveFixOrigin(usableFix.source),
          }
        : {
            latitude: Number(details.latitude),
            longitude: Number(details.longitude),
            capturedAt: details.createdAt.toISOString(),
            origin: 'ACTIVATION' as const,
          };

    // Omitted entirely when there is no session. See the DTO comment.
    const tracking =
      session === null || session === undefined
        ? undefined
        : {
            state: deriveTrackingState(session, now),
            lastFixReceivedAt:
              session.lastFixReceivedAt?.toISOString() ?? null,
          };

    return {
      state: 'VALID',
      incident: {
        personName,
        status: 'OPEN',
        triggeredAt: details.createdAt.toISOString(),
        location,
        ...(tracking === undefined ? {} : { tracking }),
        retriggerCount: details.retriggerCount,
        lastRetriggeredAt:
          details.retriggerCount > 0
            ? (details.lastTriggeredAt?.toISOString() ?? null)
            : null,
      },
      serverTime: now.toISOString(),
    };
  }
}
