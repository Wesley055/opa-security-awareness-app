import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  deriveFixOrigin,
  deriveTrackingState,
} from '../incident-access/tracking-state';
import { deriveMovementIntelligence } from './movement-intelligence';

/**
 * Operator-facing live tracking read for 14A-8b.
 *
 * AUTHORIZATION IS NOT DONE HERE.
 * IncidentDetailController is class-guarded by JwtAuthGuard +
 * IncidentAccessGuard, exactly like the existing incident detail read.
 *
 * This service is deliberately READ ONLY.
 *
 * Latest-position semantics reuse PublicTrackingService:
 *   receivedAt DESC, sequence DESC
 *
 * Route/travel semantics use:
 *   recordedAt ASC
 *
 * That distinction matters because offline buffering means receipt order and
 * movement order are not necessarily the same.
 */

export const OPERATOR_ROUTE_POINT_LIMIT = 120;

@Injectable()
export class IncidentTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async getTracking(incidentId: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        latitude: true,
        longitude: true,
        createdAt: true,
        journeySessionId: true,
      },
    });

    // Normally unreachable through IncidentDetailController because
    // IncidentAccessGuard checks existence first. Keep the service safe for
    // any future caller that might invoke it directly.
    if (!incident) {
      throw new NotFoundException('Incident not found.');
    }

    const serverTime = new Date();

    const activationLocation = {
      latitude: Number(incident.latitude),
      longitude: Number(incident.longitude),
      recordedAt: incident.createdAt.toISOString(),
      receivedAt: null,
      source: 'activation',
      origin: 'ACTIVATION' as const,
    };

    if (incident.journeySessionId === null) {
      return {
        state: 'NO_SESSION' as const,
        lastFixReceivedAt: null,
        latest: activationLocation,
        points: [],
        serverTime: serverTime.toISOString(),
      };
    }

    const sessionId = incident.journeySessionId;

    const [session, latestFix, newestRoutePoints] = await Promise.all([
      this.prisma.journeySession.findUnique({
        where: { id: sessionId },
        select: {
          status: true,
          lastFixReceivedAt: true,
        },
      }),

      /*
       * Reuse the established public-tracking newest-fix rule.
       *
       * receivedAt alone is insufficient because one ingest batch gives every
       * row the same receivedAt. sequence is therefore the required tie-break.
       *
       * Redacted rows cannot be used as a location.
       */
      this.prisma.journeyLocationFix.findFirst({
        where: {
          journeySessionId: sessionId,
          latitude: { not: null },
          longitude: { not: null },
        },
        orderBy: [{ receivedAt: 'desc' }, { sequence: 'desc' }],
        select: {
          sequence: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          speed: true,
          heading: true,
          source: true,
          recordedAt: true,
          receivedAt: true,
        },
      }),

      /*
       * BOUNDED. Never ship an entire JourneyLocationFix history on every
       * Command Center refresh.
       *
       * Fetch newest N by movement time, then reverse below so the response is
       * oldest -> newest and can be drawn directly as a route.
       */
      this.prisma.journeyLocationFix.findMany({
        where: {
          journeySessionId: sessionId,
          latitude: { not: null },
          longitude: { not: null },
        },
        orderBy: [{ recordedAt: 'desc' }, { sequence: 'desc' }],
        take: OPERATOR_ROUTE_POINT_LIMIT,
        select: {
          sequence: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          speed: true,
          heading: true,
          source: true,
          recordedAt: true,
          receivedAt: true,
        },
      }),
    ]);

    // FK integrity should make this impossible while the incident still
    // carries journeySessionId, but do not manufacture tracking state if the
    // relation is unexpectedly absent.
    if (session === null) {
      throw new NotFoundException('Journey session not found.');
    }

    const latest =
      latestFix === null
        ? activationLocation
        : {
            sequence: latestFix.sequence,
            latitude: Number(latestFix.latitude),
            longitude: Number(latestFix.longitude),
            accuracy: latestFix.accuracy,
            speed: latestFix.speed,
            heading: latestFix.heading,
            source: latestFix.source,
            origin: deriveFixOrigin(latestFix.source),
            recordedAt: latestFix.recordedAt.toISOString(),
            receivedAt: latestFix.receivedAt.toISOString(),
          };

    const points = newestRoutePoints
      .slice()
      .reverse()
      .map((fix) => ({
        sequence: fix.sequence,
        latitude: Number(fix.latitude),
        longitude: Number(fix.longitude),
        accuracy: fix.accuracy,
        speed: fix.speed,
        heading: fix.heading,
        source: fix.source,
        origin: deriveFixOrigin(fix.source),
        recordedAt: fix.recordedAt.toISOString(),
        receivedAt: fix.receivedAt.toISOString(),
      }));

    const movement = deriveMovementIntelligence(
      {
        latitude: activationLocation.latitude,
        longitude: activationLocation.longitude,
      },
      points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        speed: point.speed,
        heading: point.heading,
        recordedAt: point.recordedAt,
      })),
    );

    return {
      state: deriveTrackingState(session, serverTime),
      lastFixReceivedAt:
        session.lastFixReceivedAt?.toISOString() ?? null,
      latest,
      points,
      movement,
      serverTime: serverTime.toISOString(),
    };
  }
}