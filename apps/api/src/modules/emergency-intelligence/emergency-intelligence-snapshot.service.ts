import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmergencyIntelligenceService } from './emergency-intelligence.service';

@Injectable()
export class EmergencyIntelligenceSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emergencyIntelligenceService: EmergencyIntelligenceService,
  ) {}

  /**
   * Rebuild the current Emergency Intelligence projection from one committed
   * canonical journey fix.
   *
   * The provider work intentionally happens outside the journey ingestion
   * transaction/advisory lock. Persistence is monotonic: an older provider
   * response cannot overwrite a snapshot derived from a newer canonical fix.
   *
   * The final INSERT ... SELECT re-checks source redaction and coordinates at
   * write time so a source fix already redacted before persistence cannot
   * recreate derived location data.
   */
  async refreshFromCommittedFix(
    journeySessionId: string,
    sourceFixSequence: number,
  ): Promise<boolean> {
    const sourceFix = await this.prisma.journeyLocationFix.findUnique({
      where: {
        journeySessionId_sequence: {
          journeySessionId,
          sequence: sourceFixSequence,
        },
      },
      select: {
        sequence: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        speed: true,
        heading: true,
        batteryLevel: true,
        isCharging: true,
        recordedAt: true,
        receivedAt: true,
        redactedAt: true,
      },
    });

    if (
      sourceFix === null ||
      sourceFix.redactedAt !== null ||
      sourceFix.latitude === null ||
      sourceFix.longitude === null
    ) {
      return false;
    }

    const intelligence =
      await this.emergencyIntelligenceService.buildLocationIntelligence({
        latitude: Number(sourceFix.latitude),
        longitude: Number(sourceFix.longitude),
        ...(sourceFix.accuracy === null
          ? {}
          : { accuracy: sourceFix.accuracy }),
        ...(sourceFix.speed === null ? {} : { speed: sourceFix.speed }),
        ...(sourceFix.heading === null ? {} : { heading: sourceFix.heading }),
        ...(sourceFix.batteryLevel === null
          ? {}
          : { batteryLevel: sourceFix.batteryLevel }),
        ...(sourceFix.isCharging === null
          ? {}
          : { isCharging: sourceFix.isCharging }),
        timestamp: sourceFix.recordedAt.toISOString(),
      });

    const payload = JSON.stringify(intelligence);
    const generatedAt = new Date(intelligence.generatedAt);

    const affected = await this.prisma.$executeRaw`
      INSERT INTO "EmergencyIntelligenceSnapshot" (
        "journeySessionId",
        "sourceFixSequence",
        "sourceFixReceivedAt",
        "generatedAt",
        "refreshedAt",
        "redactedAt",
        "payload"
      )
      SELECT
        ${journeySessionId}::uuid,
        ${sourceFix.sequence},
        ${sourceFix.receivedAt},
        ${generatedAt},
        CURRENT_TIMESTAMP,
        NULL,
        ${payload}::jsonb
      FROM "JourneyLocationFix" AS source
      WHERE source."journeySessionId" = ${journeySessionId}::uuid
        AND source."sequence" = ${sourceFix.sequence}
        AND source."redactedAt" IS NULL
        AND source."latitude" IS NOT NULL
        AND source."longitude" IS NOT NULL
      ON CONFLICT ("journeySessionId") DO UPDATE
      SET
        "sourceFixSequence" = EXCLUDED."sourceFixSequence",
        "sourceFixReceivedAt" = EXCLUDED."sourceFixReceivedAt",
        "generatedAt" = EXCLUDED."generatedAt",
        "refreshedAt" = CURRENT_TIMESTAMP,
        "redactedAt" = NULL,
        "payload" = EXCLUDED."payload"
      WHERE
        EXCLUDED."sourceFixSequence" >
        "EmergencyIntelligenceSnapshot"."sourceFixSequence"
    `;

    return affected > 0;
  }
}