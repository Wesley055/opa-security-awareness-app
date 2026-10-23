import { EvidenceController } from './evidence.controller';

describe('EvidenceController download URL', () => {
  it('passes both incidentId and evidenceId to the service', async () => {
    const evidenceService = {
      getDownloadUrl: jest.fn().mockResolvedValue(
        'https://example.test/evidence?sp=r',
      ),
    };

    const controller = new EvidenceController(
      evidenceService as never,
    );

    const result = await controller.getDownloadUrl(
      'incident-a',
      'evidence-b',
    );

    expect(evidenceService.getDownloadUrl).toHaveBeenCalledWith(
      'incident-a',
      'evidence-b',
    );

    expect(result).toBe(
      'https://example.test/evidence?sp=r',
    );
  });
});
