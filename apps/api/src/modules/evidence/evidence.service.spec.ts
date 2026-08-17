import { NotFoundException } from '@nestjs/common';
import { EvidenceService } from './evidence.service';

describe('EvidenceService download access', () => {
  const incidentId = '11111111-1111-4111-8111-111111111111';
  const evidenceId = '22222222-2222-4222-8222-222222222222';

  // Synthetic key used only for local SAS signing in this unit test.
  // generateSasUrl signs locally and performs no network request.
  const accountKey = Buffer.alloc(32, 7).toString('base64');

  const connectionString =
    'DefaultEndpointsProtocol=https;' +
    'AccountName=opatestaccount;' +
    `AccountKey=${accountKey};` +
    'EndpointSuffix=core.windows.net';

  const prisma = {
    evidence: {
      findFirst: jest.fn(),
    },
  };

  const timelineService = {};

  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'AZURE_STORAGE_CONNECTION_STRING') {
        return connectionString;
      }

      if (key === 'AZURE_STORAGE_CONTAINER') {
        return 'opa-evidence-test';
      }

      throw new Error(`Unexpected config key: ${key}`);
    }),
  };

  let service: EvidenceService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new EvidenceService(
      prisma as never,
      timelineService as never,
      config as never,
    );
  });

  it('binds the evidence lookup to both incidentId and evidenceId', async () => {
    prisma.evidence.findFirst.mockResolvedValue({
      id: evidenceId,
      incidentId,
      storageKey: `incidents/${incidentId}/evidence/${evidenceId}`,
    });

    await service.getDownloadUrl(incidentId, evidenceId);

    expect(prisma.evidence.findFirst).toHaveBeenCalledWith({
      where: {
        id: evidenceId,
        incidentId,
      },
    });
  });

  it('produces a real read-only SAS URL using the Azure SDK', async () => {
    prisma.evidence.findFirst.mockResolvedValue({
      id: evidenceId,
      incidentId,
      storageKey: `incidents/${incidentId}/evidence/${evidenceId}`,
    });

    const result = await service.getDownloadUrl(incidentId, evidenceId);

    const url = new URL(result);

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe(
      'opatestaccount.blob.core.windows.net',
    );

    // This assertion exercises the REAL Azure SDK serializer.
    // The formerly broken { read: true } as never implementation
    // throws before a usable URL can be produced.
    expect(url.searchParams.get('sp')).toBe('r');

    expect(url.searchParams.get('sr')).toBe('b');
    expect(url.searchParams.get('sig')).toBeTruthy();
  });

  it('rejects evidence that is not bound to the authorized incident', async () => {
    prisma.evidence.findFirst.mockResolvedValue(null);

    await expect(
      service.getDownloadUrl(incidentId, evidenceId),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.evidence.findFirst).toHaveBeenCalledWith({
      where: {
        id: evidenceId,
        incidentId,
      },
    });
  });

  it('rejects evidence whose blob is not available yet', async () => {
    prisma.evidence.findFirst.mockResolvedValue({
      id: evidenceId,
      incidentId,
      storageKey: null,
    });

    await expect(
      service.getDownloadUrl(incidentId, evidenceId),
    ).rejects.toThrow('Evidence file is not available.');
  });
});
