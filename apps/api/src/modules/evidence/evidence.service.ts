import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient, BlockBlobClient } from '@azure/storage-blob';
import { EvidenceType } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IncidentTimelineService } from '../incident-timeline/incident-timeline.service';

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
  private readonly blobServiceClient: BlobServiceClient;
  private readonly containerName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly timelineService: IncidentTimelineService,
    config: ConfigService,
  ) {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(
      config.getOrThrow<string>('AZURE_STORAGE_CONNECTION_STRING'),
    );
    this.containerName = config.getOrThrow<string>('AZURE_STORAGE_CONTAINER');
  }

  /**
   * Uploads one evidence file for an incident. Hashes the buffer before
   * upload, so the sha256 reflects exactly what was captured — not
   * something recomputed after the fact from whatever ended up in
   * storage. If an identical file (same incidentId + sha256) was
   * already uploaded, returns the existing record instead of creating
   * a duplicate — the schema's unique constraint enforces this at the
   * database level too, this just makes it a graceful no-op rather
   * than an error for the caller.
   */
  async uploadEvidence(params: {
    incidentId: string;
    type: EvidenceType;
    buffer: Buffer;
    mimeType: string;
    capturedAt?: Date;
    actorUserId: string;
  }) {
    const sha256 = createHash('sha256').update(params.buffer).digest('hex');

    const existing = await this.prisma.evidence.findUnique({
      where: {
        incidentId_sha256: {
          incidentId: params.incidentId,
          sha256,
        },
      },
    });

    if (existing) {
      this.logger.warn(
        `Duplicate evidence upload for incident ${params.incidentId}, sha256 ${sha256} — returning existing record`,
      );
      return existing;
    }

    const record = await this.prisma.evidence.create({
      data: {
        incidentId: params.incidentId,
        type: params.type,
        status: 'PENDING',
        mimeType: params.mimeType,
        sizeBytes: BigInt(params.buffer.length),
        sha256,
        capturedAt: params.capturedAt,
      },
    });

    const storageKey = `incidents/${params.incidentId}/evidence/${record.id}`;

    try {
      const containerClient = this.blobServiceClient.getContainerClient(
        this.containerName,
      );
      const blockBlobClient = containerClient.getBlockBlobClient(storageKey);

      await blockBlobClient.uploadData(params.buffer, {
        blobHTTPHeaders: { blobContentType: params.mimeType },
      });

      const updated = await this.prisma.evidence.update({
        where: { id: record.id },
        data: {
          status: 'STORED',
          storageKey,
          uploadedAt: new Date(),
        },
      });

      await this.timelineService.recordEvent({
        incidentId: params.incidentId,
        type: 'EVIDENCE_ADDED',
        source: 'EVIDENCE_SERVICE',
        actorUserId: params.actorUserId,
        payload: {
          evidenceId: record.id,
          evidenceType: params.type,
          sha256,
          sizeBytes: params.buffer.length,
        },
      });

      return updated;
    } catch (error) {
      this.logger.error(
        `Evidence upload failed for incident ${params.incidentId}`,
        error instanceof Error ? error.stack : String(error),
      );

      await this.prisma.evidence.update({
        where: { id: record.id },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  listForIncident(incidentId: string) {
    return this.prisma.evidence.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Evidence is never served from a permanent public URL — every
   * download goes through a short-lived SAS token, generated on
   * demand, so access is tied to this specific authorized request
   * rather than a link that could be copied and reused indefinitely.
   */
  async getDownloadUrl(evidenceId: string): Promise<string> {
    const evidence = await this.prisma.evidence.findUniqueOrThrow({
      where: { id: evidenceId },
    });

    if (!evidence.storageKey) {
      throw new Error('Evidence has no stored file yet.');
    }

    const containerClient = this.blobServiceClient.getContainerClient(
      this.containerName,
    );
    const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(
      evidence.storageKey,
    );

    return blockBlobClient.generateSasUrl({
      permissions: { read: true } as never,
      expiresOn: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });
  }
}