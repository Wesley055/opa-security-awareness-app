import { BlockBlobClient } from '@azure/storage-blob';
import { EvidenceService } from '../../src/modules/evidence/evidence.service';
import { IncidentTimelineService } from '../../src/modules/incident-timeline/incident-timeline.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { prismaTest } from './prisma-test-client';
import { createIncident, createUser, waitFor } from './fixtures';

describe('Evidence publication consistency', () => {
  const timeline = new IncidentTimelineService(prismaTest as PrismaService);
  const config = { getOrThrow: (key: string) => key === 'AZURE_STORAGE_CONTAINER'
    ? 'isolated-test' : `DefaultEndpointsProtocol=https;AccountName=opatestaccount;AccountKey=${Buffer.alloc(32, 7).toString('base64')};EndpointSuffix=core.windows.net` };
  const service = () => new EvidenceService(prismaTest as PrismaService, timeline, config as never);
  const input = async () => {
    const user = await createUser();
    const incident = await createIncident(user.id);
    return { incidentId: incident.id, actorUserId: user.id, type: 'IMAGE' as const,
      buffer: Buffer.from('isolated evidence bytes'), mimeType: 'image/jpeg' };
  };
  beforeEach(() => {
    jest.spyOn(BlockBlobClient.prototype, 'uploadData').mockResolvedValue({} as Awaited<ReturnType<BlockBlobClient['uploadData']>>);
  });
  afterEach(() => jest.restoreAllMocks());

  it('rolls back publication when chronology fails, then repairs the same evidence on retry', async () => {
    const params = await input();
    const fail = jest.spyOn(timeline, 'recordEvent').mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service().uploadEvidence(params)).rejects.toThrow('audit unavailable');
    const failed = await prismaTest.evidence.findFirstOrThrow();
    expect(failed.status).toBe('FAILED');
    expect(failed.storageKey).toBeNull();
    expect(await prismaTest.incidentTimelineEvent.count()).toBe(0);
    fail.mockRestore();
    const stored = await service().uploadEvidence(params);
    expect(stored.id).toBe(failed.id);
    expect(stored.status).toBe('STORED');
    expect(await prismaTest.evidence.count()).toBe(1);
    const event = await prismaTest.incidentTimelineEvent.findFirstOrThrow();
    expect(event.actorUserId).toBe(params.actorUserId);
    expect(event.payload).toMatchObject({ evidenceId: stored.id, evidenceType: 'IMAGE' });
    expect(await timeline.verifyChain(params.incidentId)).toEqual({ valid: true });
  });

  it('concurrent identical uploads publish one row and one event', async () => {
    const params = await input();
    const rows = await Promise.all([service().uploadEvidence(params), service().uploadEvidence(params)]);
    expect(rows[0].id).toBe(rows[1].id);
    expect(rows.every(row => row.status === 'STORED')).toBe(true);
    expect(await prismaTest.evidence.count()).toBe(1);
    expect(await prismaTest.incidentTimelineEvent.count()).toBe(1);
  });

  it('permits authoritative evidence chronology after closure without reopening the incident', async () => {
    const params = await input();
    await prismaTest.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, hashtext(${params.incidentId}))`;
      await tx.incident.update({ where: { id: params.incidentId }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
      await timeline.recordEvent({ incidentId: params.incidentId, type: 'INCIDENT_RESOLVED', source: 'TEST', actorUserId: params.actorUserId }, tx);
    });
    await service().uploadEvidence(params);
    expect((await prismaTest.incident.findUniqueOrThrow({ where: { id: params.incidentId } })).status).toBe('RESOLVED');
    expect((await timeline.getTimeline(params.incidentId)).map(row => row.type)).toEqual(['INCIDENT_RESOLVED', 'EVIDENCE_ADDED']);
    expect(await timeline.verifyChain(params.incidentId)).toEqual({ valid: true });
  });

  it('does not issue download authority for failed evidence with a leftover storage key', async () => {
    const params = await input();
    const row = await service().uploadEvidence(params);
    await prismaTest.evidence.update({ where: { id: row.id }, data: { status: 'FAILED' } });
    await expect(service().getDownloadUrl(params.incidentId, row.id)).rejects.toThrow('Evidence file is not available.');
  });

  it('a failed concurrent transport cannot demote an already audited successful retry', async () => {
    const params = await input();
    let fail: ((error: Error) => void) | undefined;
    jest.mocked(BlockBlobClient.prototype.uploadData).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const first = service().uploadEvidence(params);
    const rejected = expect(first).rejects.toThrow('transport failed');
    await waitFor(() => fail !== undefined);
    const successful = await service().uploadEvidence(params);
    fail!(new Error('transport failed'));
    await rejected;
    expect((await prismaTest.evidence.findUniqueOrThrow({ where: { id: successful.id } })).status).toBe('STORED');
    expect(await prismaTest.incidentTimelineEvent.count()).toBe(1);
  });

  it('does not revive deleted evidence on retry', async () => {
    const params = await input();
    const stored = await service().uploadEvidence(params);
    await prismaTest.evidence.update({ where: { id: stored.id }, data: { status: 'DELETED' } });
    await expect(service().uploadEvidence(params)).rejects.toThrow('Deleted evidence cannot be uploaded again.');
    expect((await prismaTest.evidence.findUniqueOrThrow({ where: { id: stored.id } })).status).toBe('DELETED');
    expect(await prismaTest.incidentTimelineEvent.count()).toBe(1);
  });
});
