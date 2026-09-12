import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/operator-session', () => ({ apiUrl: () => 'https://api.example.test', getAccessToken: async () => 'test-token' }));
import { loadInsightOverview, parseInsight } from './insight-overview';
describe('Insight server boundary', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('rejects malformed and incompatible contracts instead of manufacturing zero metrics', () => {
    expect(() => parseInsight({ schemaVersion: 2 })).toThrow();
    expect(() => parseInsight({ schemaVersion: 1, metrics: { incidentCount: '0' } })).toThrow();
  });
  it('does not convert a missing delivery map into zero confirmed outcomes', () => {
    expect(() => parseInsight({ schemaVersion: 1, metrics: { incidentCount: 0, unresolved: 0, staleUnresolved: 0,
      resolutionLatency: { meanMs: null }, acknowledgementLatency: { meanMs: null },
      evidenceCompleteness: { present: 0, possible: 0 }, missingEvidence: 0 }, correctiveActions: { overdue: 0 } })).toThrow('Missing delivery outcomes');
  });
  it('uses server authorization, no cache and a server-chosen time window', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
    expect(await loadInsightOverview()).toEqual({ state: 'DENIED' });
    expect(fetcher.mock.calls[0]?.[0]).toContain('/internal/insight/overview?from=');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer test-token' } });
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('facilityId');
  });
});
