import type { Prisma } from "@prisma/client";
import { deriveTrackingState } from "../incident-access/tracking-state";

export function safeWalkEmergencyProvenance(
  incidentId: string,
  session:
    | {
        purpose: string;
        safeWalkEmergencyIncidentId: string | null;
        safeWalkEmergencyAt: Date | null;
      }
    | null
    | undefined,
) {
  return session?.purpose === "SAFEWALK" &&
    session.safeWalkEmergencyIncidentId === incidentId &&
    session.safeWalkEmergencyAt
    ? {
        source: "SAFEWALK_EXPLICIT" as const,
        emergencyStartedAt: session.safeWalkEmergencyAt.toISOString(),
      }
    : null;
}

/** Caller has already established current institutional incident authority in this transaction.
 * Query from canonical Incidents, never from a private-journey directory.
 * Both linkage directions must match. Buffered personal fixes received after SOS stay excluded.
 */
export async function readSafeWalkEmergencies(
  tx: Prisma.TransactionClient,
  facilityId: string,
) {
  const rows = await tx.$queryRawUnsafe<
    Array<{
      id: string;
      status: string;
      emergencyStartedAt: Date;
      acknowledged: boolean;
      lastOperationalEvent: string | null;
      lastFixReceivedAt: Date | null;
      sessionStatus: string;
    }>
  >(
    'SELECT i.id, i.status, j."safeWalkEmergencyAt" AS "emergencyStartedAt", j.status AS "sessionStatus", ' +
      "EXISTS (SELECT 1 FROM \"IncidentTimelineEvent\" e WHERE e.\"incidentId\"=i.id AND e.type='OPERATOR_ACKNOWLEDGED' AND e.source='COMMAND_CENTER') AS acknowledged, " +
      "(SELECT e.type FROM \"IncidentTimelineEvent\" e WHERE e.\"incidentId\"=i.id AND e.source='COMMAND_CENTER' AND e.type IN ('OPERATOR_SEEN','OPERATOR_ACKNOWLEDGED','OPERATOR_DISPATCHED','OPERATOR_RESPONSE_PROGRESS','OPERATOR_ESCALATION') ORDER BY e.sequence DESC LIMIT 1) AS \"lastOperationalEvent\", " +
      '(SELECT MAX(f."receivedAt") FROM "JourneyLocationFix" f WHERE f."journeySessionId"=j.id AND f."latitude" IS NOT NULL AND f."longitude" IS NOT NULL AND f."recordedAt">=GREATEST(j."safeWalkEmergencyAt",i."createdAt") AND f."receivedAt">=GREATEST(j."safeWalkEmergencyAt",i."createdAt")) AS "lastFixReceivedAt" ' +
      'FROM "Incident" i JOIN "JourneySession" j ON j.id=i."journeySessionId" AND j."safeWalkEmergencyIncidentId"=i.id ' +
      'WHERE i."facilityId"=$1::uuid AND j.purpose=\'SAFEWALK\' AND j."safeWalkEmergencyAt" IS NOT NULL ' +
      "ORDER BY (i.status IN ('OPEN','ACKNOWLEDGED')) DESC, i.\"createdAt\" DESC, i.id DESC LIMIT 101",
    facilityId,
  );
  const now = new Date();
  return {
    facilityId,
    serverTime: now.toISOString(),
    hasMore: rows.length > 100,
    incidents: rows.slice(0, 100).map(({ sessionStatus, ...row }) => ({
      ...row,
      emergencyStartedAt: row.emergencyStartedAt.toISOString(),
      lastFixReceivedAt: row.lastFixReceivedAt?.toISOString() ?? null,
      trackingState: deriveTrackingState(
        { status: sessionStatus, lastFixReceivedAt: row.lastFixReceivedAt },
        now,
      ),
    })),
  };
}
